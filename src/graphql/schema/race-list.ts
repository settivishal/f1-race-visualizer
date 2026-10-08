import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { meetings, races } from '@/db/schema';
import { builder } from '../builder';
import { Race, type RaceRow } from './race';
import { RaceType } from './enums';

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
const RaceSlug = builder
  .objectRef<{ slug: string; date: Date; type: 'GRAND_PRIX' | 'SPRINT'; name: string }>('RaceSlug')
  .implement({
    fields: (t) => ({
      slug: t.exposeString('slug'),
      date: t.field({ type: 'DateTime', resolve: (r) => r.date }),
      type: t.field({ type: RaceType, resolve: (r) => r.type }),
      /** The meeting's name, for a link that has to say where it goes. */
      name: t.exposeString('name'),
    }),
  });

builder.queryField('raceSlugs', (t) =>
  t.field({
    type: [RaceSlug],
    resolve: (_root, _args, ctx) =>
      ctx.db
        .select({ slug: races.slug, date: races.date, type: races.type, name: meetings.name })
        .from(races)
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
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
