import { and, asc, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import { meetings, raceEvents, racePositions, raceResults, races } from '@/db/schema';
import { builder } from '../builder';
import type { Db } from '../context';
import type { PodiumSlot } from '../loaders';
import { RaceAnalysis, loadAnalysis, positionColumns, type PositionRow } from './analysis';
import { driverOfAssignment, teamOfAssignment } from './assignment';
import { Driver, Team } from './entity';
import { Meeting } from './meeting';

export type RaceRow = typeof races.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;
type ResultRow = typeof raceResults.$inferSelect;

const RaceType = builder.enumType('RaceType', { values: ['GRAND_PRIX', 'SPRINT'] as const });
/** What this race's era published. See the `data_tier` enum in db/schema.ts. */
const DataTier = builder.enumType('DataTier', { values: ['FULL', 'LAPS'] as const });
const DriverStatus = builder.enumType('DriverStatus', {
  values: ['FINISHED', 'DNF', 'DNS', 'DSQ'] as const,
});

export const RacePosition = builder.objectRef<PositionRow>('RacePosition').implement({
  fields: (t) => ({
    lap: t.exposeInt('lap'),
    position: t.exposeInt('position'),
    lapTime: t.exposeFloat('lapTime', { nullable: true }),
    sector1: t.exposeFloat('sector1', { nullable: true }),
    sector2: t.exposeFloat('sector2', { nullable: true }),
    sector3: t.exposeFloat('sector3', { nullable: true }),
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) => driverOfAssignment(ctx, row.assignmentId),
    }),
    team: t.field({
      type: Team,
      nullable: true,
      resolve: (row, _args, ctx) => teamOfAssignment(ctx, row.assignmentId),
    }),
  }),
});

export const RaceEvent = builder.objectRef<EventRow>('RaceEvent').implement({
  fields: (t) => ({
    lap: t.exposeInt('lap'),
    type: t.exposeString('type'),
    details: t.exposeString('details'),
    // Null is meaningful here: a safety car or a red flag belongs to the race,
    // not to any one driver.
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) =>
        row.assignmentId === null ? null : driverOfAssignment(ctx, row.assignmentId),
    }),
  }),
});

export const RaceResult = builder.objectRef<ResultRow>('RaceResult').implement({
  fields: (t) => ({
    gridPosition: t.exposeInt('gridPosition', { nullable: true }),
    // Null when not classified — a DNF has no finishing position.
    finalPosition: t.exposeInt('finalPosition', { nullable: true }),
    status: t.field({ type: DriverStatus, resolve: (r) => r.status }),
    lapsCompleted: t.exposeInt('lapsCompleted'),
    points: t.exposeFloat('points'),
    fastestLap: t.exposeBoolean('fastestLap'),
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) => driverOfAssignment(ctx, row.assignmentId),
    }),
    team: t.field({
      type: Team,
      nullable: true,
      resolve: (row, _args, ctx) => teamOfAssignment(ctx, row.assignmentId),
    }),
  }),
});

const PodiumSlotRef = builder.objectRef<PodiumSlot>('PodiumSlot').implement({
  fields: (t) => ({
    position: t.exposeInt('position'),
    code: t.exposeString('code'),
    teamColor: t.exposeString('teamColor', { nullable: true }),
  }),
});

// ── The replay payload, pivoted by driver ─────────────────────────────

type ReplayDriverShape = { assignmentId: string; positions: PositionRow[] };

const ReplaySummary = builder
  .objectRef<{ lapCount: number; maxLap: number; maxPosition: number; driverCount: number }>('ReplaySummary')
  .implement({
    fields: (t) => ({
      // Laps that actually carry data, which is not the same as maxLap: a race
      // can be missing whole lap ranges upstream (2025-miami has no laps 2-24).
      lapCount: t.exposeInt('lapCount'),
      maxLap: t.exposeInt('maxLap'),
      maxPosition: t.exposeInt('maxPosition'),
      driverCount: t.exposeInt('driverCount'),
    }),
  });

const ReplayDriver = builder.objectRef<ReplayDriverShape>('ReplayDriver').implement({
  fields: (t) => ({
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) => driverOfAssignment(ctx, row.assignmentId),
    }),
    team: t.field({
      type: Team,
      nullable: true,
      resolve: (row, _args, ctx) => teamOfAssignment(ctx, row.assignmentId),
    }),
    positions: t.field({ type: [RacePosition], resolve: (row) => row.positions }),
  }),
});

type ReplayShape = { raceId: string; rows: PositionRow[] };

const RaceReplay = builder.objectRef<ReplayShape>('RaceReplay').implement({
  fields: (t) => ({
    summary: t.field({
      type: ReplaySummary,
      resolve: ({ rows }) => {
        const laps = new Set(rows.map((r) => r.lap));
        const assignments = new Set(rows.map((r) => r.assignmentId));
        return {
          lapCount: laps.size,
          // Derived from the rows, never from races.laps: the declared lap
          // count and the laps actually present disagree where upstream has
          // holes.
          maxLap: rows.reduce((max, r) => (r.lap > max ? r.lap : max), 0),
          maxPosition: rows.reduce((max, r) => (r.position > max ? r.position : max), 0),
          driverCount: assignments.size,
        };
      },
    }),
    // The laps that exist, ascending — not a 1..N range. A consumer stepping
    // 1..maxLap would stall on the gaps.
    laps: t.field({
      type: ['Int'],
      resolve: ({ rows }) => [...new Set(rows.map((r) => r.lap))].sort((a, b) => a - b),
    }),
    drivers: t.field({
      type: [ReplayDriver],
      resolve: ({ rows }) => {
        const byAssignment = new Map<string, PositionRow[]>();
        for (const row of rows) {
          const list = byAssignment.get(row.assignmentId);
          if (list) list.push(row);
          else byAssignment.set(row.assignmentId, [row]);
        }
        return [...byAssignment].map(([assignmentId, positions]) => ({
          assignmentId,
          positions: positions.sort((a, b) => a.lap - b.lap),
        }));
      },
    }),
    events: t.field({
      type: [RaceEvent],
      resolve: ({ raceId }, _args, ctx) =>
        ctx.db.select().from(raceEvents)
          .where(eq(raceEvents.raceId, raceId))
          .orderBy(asc(raceEvents.lap)),
    }),
  }),
});

// ── Race ──────────────────────────────────────────────────────────────

// Declared before it is implemented, and Meeting likewise: Race has a meeting
// and a Meeting has races, so the two modules reference each other. Splitting
// the ref from its fields breaks the cycle for the type checker, which cannot
// infer a shape that depends on itself.
/**
 * A race that has not been run is not the same as one that was abandoned, and
 * neither is the same as one whose import came back empty. `laps === 0` used to
 * mean all three.
 */
const RaceStatus = builder.enumType('RaceStatus', {
  values: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const,
});

export const Race = builder.objectRef<RaceRow>('Race');

Race.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    type: t.field({ type: RaceType, resolve: (r) => r.type }),
    laps: t.exposeInt('laps'),
    isFeatured: t.exposeBoolean('isFeatured'),
    status: t.field({ type: RaceStatus, resolve: (race) => race.status }),
    // Which columns an admin owns. Exposed so the editor can say so — a field
    // pinned by accident and never shown is a stale value nothing can correct.
    adminEdited: t.exposeStringList('adminEdited'),
    // How much of this race exists, so a client can say "this era published no
    // sector times" rather than rendering empty columns.
    dataTier: t.field({ type: DataTier, resolve: (r) => r.dataTier }),
    // Upstream's public identifier for the session. Exposed because the admin
    // needs it to re-run an import, and it is nullable because a race can be
    // in the database without one — a manually created row, or an import that
    // predates the column.
    openf1SessionKey: t.exposeInt('openf1SessionKey', { nullable: true }),
    date: t.field({ type: 'DateTime', resolve: (r) => r.date }),
    /**
     * The sprint that shared this race's weekend, if there was one.
     *
     * A sprint is a session inside a round, not a round of its own, so the
     * library lists grands prix and hangs the weekend's sprint off this rather
     * than showing the same weekend twice. Null for a weekend without one, and
     * for the sprint itself — a sprint does not have a sprint.
     */
    weekendSprint: t.field({
      type: Race,
      nullable: true,
      resolve: (race, _args, ctx) =>
        race.type === 'SPRINT' ? null : ctx.loaders.sprintByMeetingId.load(race.meetingId),
    }),

    // Through the loader, not a findFirst: the race library asks this once per
    // tile, which was 31 statements for a season that fits on one page.
    meeting: t.field({
      type: Meeting,
      nullable: true,
      resolve: (race, _args, ctx) => ctx.loaders.meetingById.load(race.meetingId),
    }),

    /**
     * The same rows pivoted by driver, which is what an animation interpolates
     * along. Deliberately redundant with `positions`.
     *
     * The pivot happens once here rather than on every render: a client
     * re-pivoting ~1,200 rows into 20 series inside a requestAnimationFrame
     * loop is real work on a phone, repeated, for output that never changes.
     */
    replay: t.field({
      type: RaceReplay,
      resolve: async (race, _args, ctx) => ({
        raceId: race.id,
        rows: await ctx.db.select(positionColumns).from(racePositions)
          .where(eq(racePositions.raceId, race.id))
          .orderBy(asc(racePositions.lap), asc(racePositions.position)),
      }),
    }),

    /**
     * Lap times, stints, pit stops and pace — the Analysis tab's whole payload
     * behind one field, so the rows it shares with the replay are read once.
     */
    analysis: t.field({
      type: RaceAnalysis,
      resolve: (race, _args, ctx) => loadAnalysis(ctx, race.id),
    }),

    events: t.field({
      type: [RaceEvent],
      args: { lap: t.arg.int() },
      resolve: (race, args, ctx) =>
        ctx.db.select().from(raceEvents)
          .where(
            args.lap == null
              ? eq(raceEvents.raceId, race.id)
              : and(eq(raceEvents.raceId, race.id), eq(raceEvents.lap, args.lap)),
          )
          .orderBy(asc(raceEvents.lap)),
    }),

    /**
     * The top three, batched.
     *
     * `results` below is one query per race, which a page of forty tiles turns
     * into forty. This goes through a loader instead, so the race library pays
     * one statement for every podium on the page. Empty for a race not run.
     */
    podium: t.field({
      type: [PodiumSlotRef],
      resolve: (race, _args, ctx) => ctx.loaders.podiumByRaceId.load(race.id),
    }),

    results: t.field({
      type: [RaceResult],
      resolve: (race, _args, ctx) =>
        ctx.db.select().from(raceResults)
          .where(eq(raceResults.raceId, race.id))
          // Unclassified drivers sort last: final_position is null for a DNF.
          .orderBy(sql`${raceResults.finalPosition} asc nulls last`),
    }),
  }),
});

builder.queryField('race', (t) =>
  t.field({
    type: Race,
    nullable: true,
    args: { slug: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const race = await ctx.db.query.races.findFirst({ where: eq(races.slug, args.slug) });
      return race ?? null;
    },
  }),
);

/**
 * The newest race that has actually been run.
 *
 * `laps > 0` is the test, not a comparison against the clock. The calendar is
 * stored whole, so the newest race by date is usually one nobody has driven —
 * and these resolvers are read inside `use cache` scopes, where "now" is
 * whenever the entry was built.
 */
const newestRunRace = (ctx: { db: Db }) =>
  ctx.db.query.races.findFirst({
    where: eq(races.status, 'COMPLETED'),
    orderBy: [desc(races.date)],
  });

builder.queryField('latestRace', (t) =>
  t.field({
    type: Race,
    nullable: true,
    resolve: async (_root, _args, ctx) => (await newestRunRace(ctx)) ?? null,
  }),
);

/**
 * The next race not yet run — the only one the library calls "upcoming".
 *
 * `status`, not a comparison against the clock, for the reason above: these
 * resolvers run inside `use cache` scopes where "now" is whenever the entry was
 * built. The cron that flips a race to COMPLETED is what moves this along.
 *
 * "Earliest SCHEDULED" alone is wrong on real data: the archive holds rows an
 * import never marked. 2023 Imola — cancelled, never run — was the earliest
 * scheduled race in the database and would have been announced as next. That
 * row has since been set to CANCELLED by hand, and `admin_edited` holds its
 * status so no re-import can put it back, which means nothing is behind the
 * fence today.
 *
 * The fence stays anyway. It is one clause, and what put Imola there was the
 * ingest having no way to know a race was called off — which is still true of
 * the next one. The newest race actually run is the line: whatever is scheduled
 * after it is ahead of us, and anything scheduled before it is a gap in the
 * archive.
 */
builder.queryField('nextRace', (t) =>
  t.field({
    type: Race,
    nullable: true,
    resolve: async (_root, _args, ctx) => {
      const latest = await newestRunRace(ctx);
      return (
        (await ctx.db.query.races.findFirst({
          where: latest
            ? and(eq(races.status, 'SCHEDULED'), gt(races.date, latest.date))
            : eq(races.status, 'SCHEDULED'),
          orderBy: [asc(races.date)],
        })) ?? null
      );
    },
  }),
);

/**
 * The race the site leads with: whichever one an admin flagged, else the
 * newest one run.
 *
 * `races.is_featured`, its mutation and its admin control have all existed
 * since M3 and nothing has ever read the flag. The home page instead fetched a
 * hundred races and took the last by date — which the stored calendar turned
 * into "a race in December that nobody has driven", and which was already
 * arbitrary once the archive passed a hundred rows.
 */
builder.queryField('featuredRace', (t) =>
  t.field({
    type: Race,
    nullable: true,
    resolve: async (_root, _args, ctx) => {
      const flagged = await ctx.db.query.races.findFirst({
        where: and(eq(races.isFeatured, true), eq(races.status, 'COMPLETED')),
        orderBy: [desc(races.date)],
      });
      return flagged ?? (await newestRunRace(ctx)) ?? null;
    },
  }),
);

/**
 * Keyset pagination on (date, id), not offset.
 *
 * An offset skips or repeats rows whenever the underlying set shifts between
 * requests, and the set here shifts on every ingest. A keyset cursor names the
 * row it left off at, so a page boundary stays put regardless.
 */
const encodeCursor = (row: RaceRow) =>
  Buffer.from(`${row.date.toISOString()}|${row.id}`).toString('base64url');

const decodeCursor = (cursor: string) => {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const parsed = new Date(date ?? '');
  if (!id || Number.isNaN(parsed.getTime())) throw new Error('Malformed cursor');
  return { date: parsed, id };
};

const RaceEdge = builder.objectRef<{ node: RaceRow }>('RaceEdge').implement({
  fields: (t) => ({
    node: t.field({ type: Race, resolve: (e) => e.node }),
    cursor: t.string({ resolve: (e) => encodeCursor(e.node) }),
  }),
});

const PageInfo = builder
  .objectRef<{
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  }>('PageInfo')
  .implement({
    fields: (t) => ({
      hasNextPage: t.exposeBoolean('hasNextPage'),
      // Paging was forward-only: a reader who took Next had no way back except
      // the browser button, and no shareable URL for the page they were on.
      hasPreviousPage: t.exposeBoolean('hasPreviousPage'),
      startCursor: t.exposeString('startCursor', { nullable: true }),
      endCursor: t.exposeString('endCursor', { nullable: true }),
    }),
  });

const RaceConnection = builder
  .objectRef<{
    edges: { node: RaceRow }[];
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  }>('RaceConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [RaceEdge], resolve: (c) => c.edges }),
      pageInfo: t.field({
        type: PageInfo,
        resolve: (c) => ({
          hasNextPage: c.hasNextPage,
          hasPreviousPage: c.hasPreviousPage,
          startCursor: c.edges.length ? encodeCursor(c.edges[0].node) : null,
          endCursor: c.edges.length ? encodeCursor(c.edges[c.edges.length - 1].node) : null,
        }),
      }),
    }),
  });

/**
 * Every race's slug and date, newest first.
 *
 * `generateStaticParams` and the sitemap both want the whole list, and both used
 * to ask `races(first:)` for it. That resolver is a keyset connection: with no
 * cursor it orders *ascending* and clamps to 100, so the prerendered set was the
 * hundred oldest races and the current season — the pages anyone actually visits
 * — was neither prerendered nor in the sitemap.
 *
 * A list is not a page, so this is not a connection. It reads two columns rather
 * than dragging whole race rows through an edge type to spell a slug, and the
 * bound is a ceiling nobody is near rather than a page size.
 */
const RaceSlug = builder.objectRef<{ slug: string; date: Date }>('RaceSlug').implement({
  fields: (t) => ({
    slug: t.exposeString('slug'),
    date: t.field({ type: 'DateTime', resolve: (r) => r.date }),
  }),
});

builder.queryField('raceSlugs', (t) =>
  t.field({
    type: [RaceSlug],
    resolve: (_root, _args, ctx) =>
      ctx.db
        .select({ slug: races.slug, date: races.date })
        .from(races)
        .orderBy(desc(races.date), desc(races.id))
        .limit(1000),
  }),
);

builder.queryField('races', (t) =>
  t.field({
    type: RaceConnection,
    args: {
      season: t.arg.int(),
      search: t.arg.string(),
      /**
       * One session kind. The library passes GRAND_PRIX so a sprint weekend is
       * one row rather than two — the sprint arrives on `Race.weekendSprint`.
       */
      type: t.arg({ type: RaceType }),
      first: t.arg.int(),
      after: t.arg.string(),
      /** The page ending just before this row, for stepping back. */
      before: t.arg.string(),
    },
    resolve: async (_root, args, ctx) => {
      // Bounded regardless of what the client asks for: `first` is an input,
      // and an unbounded page is a denial of service with extra steps.
      const limit = Math.min(Math.max(args.first ?? 20, 1), 100);
      const filters = [];

      if (args.season != null) filters.push(eq(meetings.seasonYear, args.season));
      if (args.type != null) filters.push(eq(races.type, args.type));
      if (args.search) {
        const pattern = `%${args.search}%`;
        filters.push(
          or(
            ilike(meetings.name, pattern),
            // Any session of the weekend, not only the row being returned.
            // With `type: GRAND_PRIX` the sprint rows are filtered out, and
            // searching "sprint" would otherwise find nothing at all — while
            // the six weekends that have one are exactly what was meant.
            sql`exists (
              select 1 from ${races} as sibling
              where sibling.meeting_id = ${races.meetingId} and sibling.slug ilike ${pattern}
            )`,
          ),
        );
      }

      // Stepping back is the same keyset walk in the other direction: take the
      // rows before the cursor, newest first, then put them back in order. It
      // stays a keyset rather than an offset for the reason above — a page
      // boundary must not move when the week's race lands.
      const backwards = args.before != null && args.after == null;

      if (args.after) {
        const cursor = decodeCursor(args.after);
        filters.push(
          sql`(${races.date}, ${races.id}) > (${cursor.date.toISOString()}, ${cursor.id})`,
        );
      } else if (args.before) {
        const cursor = decodeCursor(args.before);
        filters.push(
          sql`(${races.date}, ${races.id}) < (${cursor.date.toISOString()}, ${cursor.id})`,
        );
      }

      // One extra row answers "is there another page that way" without a second
      // count query.
      const rows = await ctx.db.select({ race: races }).from(races)
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(
          backwards ? desc(races.date) : asc(races.date),
          backwards ? desc(races.id) : asc(races.id),
        )
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      if (backwards) page.reverse();

      return {
        edges: page.map((r) => ({ node: r.race })),
        // Walking backwards, the extra row is evidence of a page *before* this
        // one; forwards it is evidence of one after.
        hasNextPage: backwards ? true : hasMore,
        hasPreviousPage: backwards ? hasMore : args.after != null,
      };
    },
  }),
);
