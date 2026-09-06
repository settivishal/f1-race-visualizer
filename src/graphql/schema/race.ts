import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import {
  driverTeamAssignments, drivers, meetings, raceEvents, racePositions,
  raceResults, races, teamSeasons, teams,
} from '@/db/schema';
import { builder } from '../builder';
import type { Context } from '../context';
import { Driver, Team } from './entity';
import { Meeting } from './meeting';

export type RaceRow = typeof races.$inferSelect;
type PositionRow = typeof racePositions.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;
type ResultRow = typeof raceResults.$inferSelect;

const RaceType = builder.enumType('RaceType', { values: ['GRAND_PRIX', 'SPRINT'] as const });
const DriverStatus = builder.enumType('DriverStatus', {
  values: ['FINISHED', 'DNF', 'DNS', 'DSQ'] as const,
});

/**
 * The assignment is how storage links a driver to a team for a season
 * (document 02, Part 3). It is a storage concern and never appears in the
 * schema: a client asks a position for its `driver`, and the resolver walks
 * the assignment to find one.
 *
 * These still run once per parent object — a thousand position rows still call
 * them a thousand times. What changed is that they no longer issue a query
 * each: every .load() made in the same tick is collected into one
 * `WHERE id IN (...)`, and a key already fetched is served from the loader's
 * cache. The walk is the same; the round trips are not.
 */
async function driverOfAssignment(ctx: Context, assignmentId: string) {
  const assignment = await ctx.loaders.assignmentById.load(assignmentId);
  if (!assignment) return null;
  return ctx.loaders.driverById.load(assignment.driverId);
}

async function teamOfAssignment(ctx: Context, assignmentId: string) {
  const assignment = await ctx.loaders.assignmentById.load(assignmentId);
  if (!assignment) return null;
  const teamSeason = await ctx.loaders.teamSeasonById.load(assignment.teamSeasonId);
  if (!teamSeason) return null;
  const team = await ctx.loaders.teamById.load(teamSeason.teamId);
  if (!team) return null;
  // The per-season livery is the more specific fact, so it wins where it
  // exists and teams.color is the fallback.
  return { ...team, color: teamSeason.color ?? team.color };
}

export const RacePosition = builder.objectRef<PositionRow>('RacePosition').implement({
  fields: (t) => ({
    lap: t.exposeInt('lap'),
    position: t.exposeInt('position'),
    gap: t.exposeString('gap', { nullable: true }),
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

export const Race = builder.objectRef<RaceRow>('Race').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    slug: t.exposeString('slug'),
    type: t.field({ type: RaceType, resolve: (r) => r.type }),
    laps: t.exposeInt('laps'),
    isFeatured: t.exposeBoolean('isFeatured'),
    date: t.field({ type: 'DateTime', resolve: (r) => r.date }),
    meeting: t.field({
      type: Meeting,
      nullable: true,
      resolve: async (race, _args, ctx) => {
        const meeting = await ctx.db.query.meetings.findFirst({
          where: eq(meetings.id, race.meetingId),
        });
        return meeting ?? null;
      },
    }),

    /**
     * Flat, one row per driver per lap — the shape the database stores and the
     * shape the timing tower wants.
     *
     * This is also where the N+1 lives: this resolver runs once and returns
     * ~1,200 rows, and then RacePosition.driver runs once *per row*, unaware
     * that it is one of 1,200 calls asking for the same twenty drivers.
     */
    positions: t.field({
      type: [RacePosition],
      args: { lap: t.arg.int() },
      resolve: (race, args, ctx) =>
        ctx.db.select().from(racePositions)
          .where(
            args.lap == null
              ? eq(racePositions.raceId, race.id)
              : and(eq(racePositions.raceId, race.id), eq(racePositions.lap, args.lap)),
          )
          // Ordering by position, never indexing by it: retirements leave the
          // places inside a lap non-contiguous.
          .orderBy(asc(racePositions.lap), asc(racePositions.position)),
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
        rows: await ctx.db.select().from(racePositions)
          .where(eq(racePositions.raceId, race.id))
          .orderBy(asc(racePositions.lap), asc(racePositions.position)),
      }),
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
  .objectRef<{ hasNextPage: boolean; endCursor: string | null }>('PageInfo')
  .implement({
    fields: (t) => ({
      hasNextPage: t.exposeBoolean('hasNextPage'),
      endCursor: t.exposeString('endCursor', { nullable: true }),
    }),
  });

const RaceConnection = builder
  .objectRef<{ edges: { node: RaceRow }[]; hasNextPage: boolean }>('RaceConnection')
  .implement({
    fields: (t) => ({
      edges: t.field({ type: [RaceEdge], resolve: (c) => c.edges }),
      pageInfo: t.field({
        type: PageInfo,
        resolve: (c) => ({
          hasNextPage: c.hasNextPage,
          endCursor: c.edges.length ? encodeCursor(c.edges[c.edges.length - 1].node) : null,
        }),
      }),
    }),
  });

builder.queryField('races', (t) =>
  t.field({
    type: RaceConnection,
    args: {
      season: t.arg.int(),
      search: t.arg.string(),
      first: t.arg.int(),
      after: t.arg.string(),
    },
    resolve: async (_root, args, ctx) => {
      // Bounded regardless of what the client asks for: `first` is an input,
      // and an unbounded page is a denial of service with extra steps.
      const limit = Math.min(Math.max(args.first ?? 20, 1), 100);
      const filters = [];

      if (args.season != null) filters.push(eq(meetings.seasonYear, args.season));
      if (args.search) {
        const pattern = `%${args.search}%`;
        filters.push(or(ilike(races.slug, pattern), ilike(meetings.name, pattern)));
      }
      if (args.after) {
        const cursor = decodeCursor(args.after);
        filters.push(
          sql`(${races.date}, ${races.id}) > (${cursor.date.toISOString()}, ${cursor.id})`,
        );
      }

      // One extra row answers hasNextPage without a second count query.
      const rows = await ctx.db.select({ race: races }).from(races)
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(races.date), asc(races.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      return {
        edges: page.map((r) => ({ node: r.race })),
        hasNextPage: rows.length > limit,
      };
    },
  }),
);
