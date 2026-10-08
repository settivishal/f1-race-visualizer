import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { raceEvents, racePositions, raceResults, races } from '@/db/schema';
import { readAppConfig } from '@/lib/app-config';
import { builder } from '../builder';
import type { Db } from '../context';
import type { PodiumSlot, PredictionRow } from '../loaders';
import { RaceAnalysis, loadAnalysis, positionColumns, type PositionRow } from './analysis';
import { assignmentFields, driverOfAssignment } from './assignment';
import { Driver, Team } from './entity';
import { DataTier, DriverStatus, RaceStatus, RaceType } from './enums';
import { Meeting } from './meeting';

export type RaceRow = typeof races.$inferSelect;
type EventRow = typeof raceEvents.$inferSelect;
type ResultRow = typeof raceResults.$inferSelect;


export const RacePosition = builder.objectRef<PositionRow>('RacePosition').implement({
  fields: (t) => ({
    lap: t.exposeInt('lap'),
    position: t.exposeInt('position'),
    lapTime: t.exposeFloat('lapTime', { nullable: true }),
    sector1: t.exposeFloat('sector1', { nullable: true }),
    sector2: t.exposeFloat('sector2', { nullable: true }),
    sector3: t.exposeFloat('sector3', { nullable: true }),
    ...assignmentFields(t),
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

/** One driver's pre-race win probability from the model in ml/. */
export const RacePrediction = builder.objectRef<PredictionRow>('RacePrediction').implement({
  fields: (t) => ({
    winProbability: t.exposeFloat('winProbability'),
    modelVersion: t.exposeString('modelVersion'),
    generatedAt: t.field({ type: 'DateTime', resolve: (row) => row.generatedAt }),
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) => ctx.loaders.driverById.load(row.driverId),
    }),
    team: t.field({
      type: Team,
      nullable: true,
      resolve: (row, _args, ctx) => ctx.loaders.latestTeamByDriverId.load(row.driverId),
    }),
  }),
});

/** How many drivers the race page's prediction panel lists, from app_config. */
const PredictionDisplay = builder.objectRef<{ shown: number; expanded: number }>('PredictionDisplay').implement({
  fields: (t) => ({
    shown: t.exposeInt('shown'),
    expanded: t.exposeInt('expanded'),
  }),
});

builder.queryField('predictionDisplay', (t) =>
  t.field({
    type: PredictionDisplay,
    resolve: async (_root, _args, ctx) => {
      const config = await readAppConfig(ctx.db);
      // The column defaults, for a database with no settings row yet.
      return config
        ? { shown: config.predictionsShown, expanded: config.predictionsExpanded }
        : { shown: 5, expanded: 10 };
    },
  }),
);

export const RaceResult = builder.objectRef<ResultRow>('RaceResult').implement({
  fields: (t) => ({
    gridPosition: t.exposeInt('gridPosition', { nullable: true }),
    // Null when not classified — a DNF has no finishing position.
    finalPosition: t.exposeInt('finalPosition', { nullable: true }),
    status: t.field({ type: DriverStatus, resolve: (r) => r.status }),
    lapsCompleted: t.exposeInt('lapsCompleted'),
    points: t.exposeFloat('points'),
    fastestLap: t.exposeBoolean('fastestLap'),
    ...assignmentFields(t),
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

type ReplayDriverShape = { assignmentId: string; positions: PositionRow[]; grid: number | null };

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
    ...assignmentFields(t),
    positions: t.field({ type: [RacePosition], resolve: (row) => row.positions }),
    /** Where the car started. Null for a pit-lane start (0 upstream) or no result yet. */
    grid: t.int({ nullable: true, resolve: (row) => row.grid }),
  }),
});

type ReplayShape = { raceId: string; rows: PositionRow[]; grid: Map<string, number> };

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
      resolve: ({ rows, grid }) => {
        const byAssignment = new Map<string, PositionRow[]>();
        for (const row of rows) {
          const list = byAssignment.get(row.assignmentId);
          if (list) list.push(row);
          else byAssignment.set(row.assignmentId, [row]);
        }
        return [...byAssignment].map(([assignmentId, positions]) => ({
          assignmentId,
          positions: positions.sort((a, b) => a.lap - b.lap),
          grid: grid.get(assignmentId) ?? null,
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
      resolve: async (race, _args, ctx) => {
        const [rows, starts] = await Promise.all([
          ctx.db.select(positionColumns).from(racePositions)
            .where(eq(racePositions.raceId, race.id))
            .orderBy(asc(racePositions.lap), asc(racePositions.position)),
          ctx.db.select({ assignmentId: raceResults.assignmentId, grid: raceResults.gridPosition })
            .from(raceResults)
            .where(eq(raceResults.raceId, race.id)),
        ]);
        // Grid 0 is a pit-lane start: no slot on the grid to draw it from.
        const grid = new Map(starts.flatMap((s) => (s.grid ? [[s.assignmentId, s.grid] as const] : [])));
        return { raceId: race.id, rows, grid };
      },
    }),

    /**
     * Lap times, stints, pit stops and pace — the Analysis tab's whole payload
     * behind one field, so the rows it shares with the replay are read once.
     */
    analysis: t.field({
      type: RaceAnalysis,
      resolve: (race, _args, ctx) => loadAnalysis(ctx, race.id),
    }),

    /**
     * Win probabilities, most likely first, from the newest model version
     * imported for this race; empty when the race has none.
     */
    predictions: t.field({
      type: [RacePrediction],
      resolve: async (race, _args, ctx) => {
        const rows = await ctx.loaders.predictionsByRaceId.load(race.id);
        const version = rows.reduce<PredictionRow | undefined>(
          (newest, row) => (!newest || row.generatedAt > newest.generatedAt ? row : newest),
          undefined,
        )?.modelVersion;
        return rows
          .filter((row) => row.modelVersion === version)
          .sort((a, b) => b.winProbability - a.winProbability);
      },
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
