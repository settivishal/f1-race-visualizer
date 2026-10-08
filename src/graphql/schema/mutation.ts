import { desc, eq } from 'drizzle-orm';
import { ingestRace } from '@/lib/ingest/run';
import { ingestRuns, meetings, races } from '@/db/schema';

const RACE_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
type RaceStatusValue = (typeof RACE_STATUSES)[number];
import { builder } from '../builder';
import { requireSession } from '../context';
import { Race } from './race';

/**
 * Everything that writes, plus the one query that only an admin may read.
 *
 * **Each field calls `requireSession` first.** That is not belt-and-braces
 * alongside the proxy — it is the only thing guarding these at all.
 * `/api/graphql` is a single public URL serving public and admin operations
 * together, so no route-level rule can tell them apart: the proxy sees one
 * path and cannot know whether the body contains `races` or `triggerIngest`.
 *
 * See docs/decisions.md, "Three guard layers, not two".
 */
type IngestRunRow = typeof ingestRuns.$inferSelect;

const IngestRunStatus = builder.enumType('IngestRunStatus', {
  values: ['RUNNING', 'SUCCESS', 'FAILED'] as const,
});

const IngestRun = builder.objectRef<IngestRunRow>('IngestRun').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    source: t.exposeString('source'),
    target: t.exposeString('target', { nullable: true }),
    status: t.field({ type: IngestRunStatus, resolve: (r) => r.status }),
    rowsWritten: t.exposeInt('rowsWritten'),
    // Carries warnings on a successful run as well as the message on a failed
    // one — run.ts records both here deliberately, because a run that
    // succeeded while noticing something is not the same as a clean one.
    error: t.exposeString('error', { nullable: true }),
    startedAt: t.field({ type: 'DateTime', resolve: (r) => r.startedAt }),
    finishedAt: t.field({
      type: 'DateTime',
      nullable: true,
      resolve: (r) => r.finishedAt,
    }),
  }),
});

builder.queryFields((t) => ({
  /**
   * The ingest history. Admin-only, and the reason is not privacy — it is that
   * the dangerous failure in this system is a cron job that quietly stopped
   * working, which produces no exception anywhere. This table is what makes
   * that visible, so it needs to be readable somewhere.
   */
  ingestRuns: t.field({
    type: [IngestRun],
    args: { first: t.arg.int({ defaultValue: 50 }) },
    resolve: (_root, args, ctx) => {
      requireSession(ctx);
      return ctx.db
        .select()
        .from(ingestRuns)
        .orderBy(desc(ingestRuns.startedAt))
        .limit(Math.min(args.first ?? 50, 200));
    },
  }),
}));

const TriggerIngestResult = builder
  .objectRef<{ slug: string; rowsWritten: number; warnings: string[] }>('TriggerIngestResult')
  .implement({
    fields: (t) => ({
      slug: t.exposeString('slug'),
      rowsWritten: t.exposeInt('rowsWritten'),
      warnings: t.exposeStringList('warnings'),
    }),
  });

builder.mutationType({
  fields: (t) => ({
    /**
     * Re-import one session from OpenF1.
     *
     * Calls the same `ingestRace` the backfill script and the cron handler
     * call, so nothing about correctness depends on which entry point invoked
     * it: same transaction boundary, same idempotency, same `ingest_runs` row.
     * There is no admin-specific import path, because a second one would be a
     * second thing to keep correct.
     *
     * Cache revalidation is deliberately *not* here. `revalidateTag` needs a
     * request context and belongs in the Server Action that calls this — a
     * resolver reaching into Next's caching is the wrong direction of
     * dependency, and this resolver also runs from the cron route, which does
     * its own revalidation.
     */
    triggerIngest: t.field({
      type: TriggerIngestResult,
      args: { sessionKey: t.arg.int({ required: true }) },
      resolve: async (_root, args, ctx) => {
        requireSession(ctx);
        return ingestRace(args.sessionKey, ctx.db);
      },
    }),

    /** Which race the landing page leads with. */
    setRaceFeatured: t.field({
      type: Race,
      args: {
        slug: t.arg.string({ required: true }),
        featured: t.arg.boolean({ required: true }),
      },
      resolve: async (_root, args, ctx) => {
        requireSession(ctx);

        // Featuring one race unfeatures the rest. The landing page picks the
        // first flagged race, so allowing several would make which one appears
        // depend on row order — a setting that looks applied and does nothing.
        if (args.featured) {
          await ctx.db
            .update(races)
            .set({ isFeatured: false, updatedAt: new Date() })
            .where(eq(races.isFeatured, true));
        }

        const [updated] = await ctx.db
          .update(races)
          .set({ isFeatured: args.featured, updatedAt: new Date() })
          .where(eq(races.slug, args.slug))
          .returning();

        if (!updated) throw new Error(`No race with slug ${args.slug}`);
        return updated;
      },
    }),

    /**
     * Corrects the human-facing names an import got wrong.
     *
     * `laps` lives on the race; the names live on its meeting, which is what
     * every page actually renders. An omitted argument leaves the column
     * alone — passing null would mean "clear it", and these are `notNull`.
     */
    updateRaceMetadata: t.field({
      type: Race,
      args: {
        slug: t.arg.string({ required: true }),
        laps: t.arg.int(),
        name: t.arg.string(),
        country: t.arg.string(),
        circuitName: t.arg.string(),
        status: t.arg.string(),
        /**
         * Columns to hand back to upstream. A field an admin no longer wants to
         * own is removed from `admin_edited`, and the next import overwrites it
         * — which is the undo, and why no previous value needs storing.
         */
        release: t.arg.stringList(),
      },
      resolve: async (_root, args, ctx) => {
        requireSession(ctx);

        const race = await ctx.db.query.races.findFirst({
          where: eq(races.slug, args.slug),
        });
        if (!race) throw new Error(`No race with slug ${args.slug}`);

        const released = new Set(args.release ?? []);

        /**
         * Every column an admin sets is recorded, because the ingest reads that
         * list to decide what it may overwrite. Without it the edit lasts until
         * the next weekly import and no longer — which is what this editor did
         * for its whole life before now.
         */
        const pin = (existing: string[], columns: string[]) => {
          const next = new Set(existing);
          for (const column of columns) next.add(column);
          for (const column of released) next.delete(column);
          return [...next];
        };

        const racePatch: Partial<typeof races.$inferInsert> = {};
        const racePinned: string[] = [];

        if (typeof args.laps === 'number') {
          // Zero is a real value here — a cancelled or unrun race has no laps —
          // so only a negative one is wrong. See the same rule in the action.
          if (args.laps < 0) throw new Error('laps cannot be negative');
          racePatch.laps = args.laps;
          racePinned.push('laps');
        }

        if (typeof args.status === 'string' && args.status) {
          if (!RACE_STATUSES.includes(args.status as RaceStatusValue)) {
            throw new Error(`status must be one of ${RACE_STATUSES.join(', ')}`);
          }
          racePatch.status = args.status as RaceStatusValue;
          racePinned.push('status');
        }

        if (Object.keys(racePatch).length > 0 || released.size > 0) {
          await ctx.db
            .update(races)
            .set({
              ...racePatch,
              adminEdited: pin(race.adminEdited, racePinned),
              updatedAt: new Date(),
            })
            .where(eq(races.id, race.id));
        }

        const meetingPatch: Partial<typeof meetings.$inferInsert> = {};
        const meetingPinned: string[] = [];
        if (typeof args.name === 'string' && args.name.trim()) {
          meetingPatch.name = args.name.trim();
          meetingPinned.push('name');
        }
        if (typeof args.country === 'string' && args.country.trim()) {
          meetingPatch.country = args.country.trim();
          meetingPinned.push('country');
        }
        // circuitName is the one nullable column of the three, so an empty
        // string is a meaningful instruction to clear it rather than a no-op.
        if (typeof args.circuitName === 'string') {
          meetingPatch.circuitName = args.circuitName.trim() || null;
          meetingPinned.push('circuit_name');
        }

        if (Object.keys(meetingPatch).length > 0 || released.size > 0) {
          const meeting = await ctx.db.query.meetings.findFirst({
            where: eq(meetings.id, race.meetingId),
          });
          await ctx.db
            .update(meetings)
            .set({
              ...meetingPatch,
              adminEdited: pin(meeting?.adminEdited ?? [], meetingPinned),
              updatedAt: new Date(),
            })
            .where(eq(meetings.id, race.meetingId));
        }

        const updated = await ctx.db.query.races.findFirst({
          where: eq(races.id, race.id),
        });
        if (!updated) throw new Error(`No race with slug ${args.slug}`);
        return updated;
      },
    }),
  }),
});
