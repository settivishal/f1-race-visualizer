import { asc, eq } from 'drizzle-orm';
import { pitStops, racePositions, raceResults, stints } from '@/db/schema';
import { summarizePace, markOutliers, type LapTime } from '@/lib/pace';
import { isRacingStop } from '@/lib/pit-stops';
import { builder } from '../builder';
import type { Context } from '../context';
import { Driver, Team } from './entity';
import { driverOfAssignment, teamOfAssignment } from './assignment';

/**
 * Everything the Analysis tab needs, behind one field.
 *
 * `Race.analysis` loads the three row sets once — positions, stints, pit stops —
 * and every field below is computed from those in memory. The alternative, a
 * resolver per statistic, would read the same 1,200 position rows four times for
 * one page. Grouping them is also what keeps the query count flat: this whole
 * subtree costs three queries plus the DataLoader batches the drivers and teams
 * already share with the replay.
 */

type StintRow = typeof stints.$inferSelect;
type PitStopRow = typeof pitStops.$inferSelect;
type ResultRow = typeof raceResults.$inferSelect;

/**
 * The position columns anything actually reads.
 *
 * `race_positions` is the largest table here — a full race is over a thousand
 * rows — and a bare `select()` returns all ten columns of every one of them.
 * `id` and `raceId` are read by nothing downstream, and they are the two
 * expensive ones: the driver speaks Postgres over a WebSocket, where a uuid
 * crosses as ~36 bytes of text, so the pair is ~72 bytes per row of egress
 * that is thrown away on arrival.
 *
 * It lives here rather than in race.ts because race.ts already imports this
 * module, and the reverse would be a cycle through the Pothos builder.
 */
export const positionColumns = {
  lap: racePositions.lap,
  position: racePositions.position,
  lapTime: racePositions.lapTime,
  sector1: racePositions.sector1,
  sector2: racePositions.sector2,
  sector3: racePositions.sector3,
  // Not exposed: what `RacePosition.driver` and `.team` resolve through.
  assignmentId: racePositions.assignmentId,
};

export type PositionRow = {
  [K in keyof typeof positionColumns]: (typeof racePositions.$inferSelect)[K];
};

export type AnalysisShape = {
  raceId: string;
  positions: PositionRow[];
  stints: StintRow[];
  pitStops: PitStopRow[];
  results: ResultRow[];
};

const Stint = builder.objectRef<StintRow>('Stint').implement({
  fields: (t) => ({
    stintNumber: t.exposeInt('stintNumber'),
    lapStart: t.exposeInt('lapStart'),
    lapEnd: t.exposeInt('lapEnd'),
    compound: t.exposeString('compound', { nullable: true }),
    tyreAgeAtStart: t.exposeInt('tyreAgeAtStart', { nullable: true }),
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

const PitStop = builder.objectRef<PitStopRow>('PitStop').implement({
  fields: (t) => ({
    lap: t.exposeInt('lap'),
    // Seconds on the wire, milliseconds in storage. The database compares; the
    // client displays.
    durationSeconds: t.float({
      nullable: true,
      resolve: (row) => (row.durationMs == null ? null : row.durationMs / 1000),
    }),
    /**
     * True where this row is a race suspension rather than a stop the driver
     * chose to make — see lib/pit-stops.ts. The row is still here: what it
     * means is a reading, and a caller that wants upstream's record verbatim
     * should still get it.
     */
    underStoppage: t.boolean({ resolve: (row) => !isRacingStop(row.durationMs) }),
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

const Lap = builder
  .objectRef<{ lap: number; time: number; isOutlier: boolean }>('Lap')
  .implement({
    fields: (t) => ({
      lap: t.exposeInt('lap'),
      time: t.exposeFloat('time'),
      /**
       * True for a lap that does not represent the driver's pace — a pit lap,
       * its out-lap, or anything more than 7% off their own median. Flagged
       * rather than removed: a chart that silently drops laps 12 to 15 looks
       * like missing data, and the safety car is worth seeing.
       */
      isOutlier: t.exposeBoolean('isOutlier'),
    }),
  });

const Pace = builder
  .objectRef<ReturnType<typeof summarizePace>>('Pace')
  .implement({
    fields: (t) => ({
      best: t.exposeFloat('best', { nullable: true }),
      median: t.exposeFloat('median', { nullable: true }),
      mean: t.exposeFloat('mean', { nullable: true }),
      consistency: t.exposeFloat('consistency', { nullable: true }),
      lapsCounted: t.exposeInt('lapsCounted'),
      lapsExcluded: t.exposeInt('lapsExcluded'),
    }),
  });

type DriverLapsShape = { assignmentId: string; laps: LapTime[]; pitLaps: number[] };

const DriverLapTimes = builder.objectRef<DriverLapsShape>('DriverLapTimes').implement({
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
    laps: t.field({
      type: [Lap],
      resolve: (row) => markOutliers(row.laps, row.pitLaps),
    }),
    pace: t.field({
      type: Pace,
      resolve: (row) => summarizePace(row.laps, row.pitLaps),
    }),
  }),
});

// ── Head to head ──────────────────────────────────────────────────────

type SideShape = {
  assignmentId: string;
  laps: LapTime[];
  pitLaps: number[];
  finalPosition: number | null;
};

const HeadToHeadSide = builder.objectRef<SideShape>('HeadToHeadSide').implement({
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
    finalPosition: t.exposeInt('finalPosition', { nullable: true }),
    pace: t.field({ type: Pace, resolve: (row) => summarizePace(row.laps, row.pitLaps) }),
  }),
});

const HeadToHeadLap = builder
  .objectRef<{ lap: number; positionDelta: number | null; timeDelta: number | null }>('HeadToHeadLap')
  .implement({
    fields: (t) => ({
      lap: t.exposeInt('lap'),
      /** Negative means A is ahead on the road. Null if one of them has no row. */
      positionDelta: t.exposeInt('positionDelta', { nullable: true }),
      /** Negative means A was quicker that lap. */
      timeDelta: t.exposeFloat('timeDelta', { nullable: true }),
    }),
  });

type HeadToHeadShape = {
  a: SideShape;
  b: SideShape;
  laps: { lap: number; positionDelta: number | null; timeDelta: number | null }[];
};

const HeadToHead = builder.objectRef<HeadToHeadShape>('HeadToHead').implement({
  fields: (t) => ({
    a: t.field({ type: HeadToHeadSide, resolve: (h) => h.a }),
    b: t.field({ type: HeadToHeadSide, resolve: (h) => h.b }),
    laps: t.field({ type: [HeadToHeadLap], resolve: (h) => h.laps }),
    lapsAheadA: t.int({
      resolve: (h) => h.laps.filter((l) => l.positionDelta != null && l.positionDelta < 0).length,
    }),
    lapsAheadB: t.int({
      resolve: (h) => h.laps.filter((l) => l.positionDelta != null && l.positionDelta > 0).length,
    }),
  }),
});

// ── The analysis payload ──────────────────────────────────────────────

/** Lap times and pit laps for one driver, from rows already in memory. */
function lapsOf(shape: AnalysisShape, assignmentId: string) {
  const laps: LapTime[] = [];
  for (const row of shape.positions) {
    if (row.assignmentId !== assignmentId || row.lapTime == null) continue;
    laps.push({ lap: row.lap, time: row.lapTime });
  }
  laps.sort((a, b) => a.lap - b.lap);

  const pitLaps = shape.pitStops
    .filter((p) => p.assignmentId === assignmentId)
    .map((p) => p.lap);

  return { laps, pitLaps };
}

function sideOf(shape: AnalysisShape, assignmentId: string): SideShape {
  const { laps, pitLaps } = lapsOf(shape, assignmentId);
  const result = shape.results.find((r) => r.assignmentId === assignmentId);
  return { assignmentId, laps, pitLaps, finalPosition: result?.finalPosition ?? null };
}

/**
 * Resolves a driver code to the assignment that drove this race.
 *
 * The code is the argument because it is what a URL can carry and what a person
 * types. Two drivers can share a code across eras, so the lookup is scoped to
 * the assignments that appear in *this* race's rows rather than to the drivers
 * table.
 */
async function assignmentForCode(
  ctx: Context,
  shape: AnalysisShape,
  code: string,
): Promise<string | null> {
  const wanted = code.trim().toUpperCase();
  const seen = [...new Set(shape.positions.map((p) => p.assignmentId))];
  for (const assignmentId of seen) {
    const driver = await driverOfAssignment(ctx, assignmentId);
    if (driver?.code.toUpperCase() === wanted) return assignmentId;
  }
  return null;
}

export const RaceAnalysis = builder.objectRef<AnalysisShape>('RaceAnalysis').implement({
  fields: (t) => ({
    stints: t.field({ type: [Stint], resolve: (a) => a.stints }),
    pitStops: t.field({ type: [PitStop], resolve: (a) => a.pitStops }),

    /** One series per driver, which is what a line chart draws. */
    lapTimes: t.field({
      type: [DriverLapTimes],
      resolve: (shape) =>
        [...new Set(shape.positions.map((p) => p.assignmentId))].map((assignmentId) => ({
          assignmentId,
          ...lapsOf(shape, assignmentId),
        })),
    }),

    headToHead: t.field({
      type: HeadToHead,
      nullable: true,
      args: {
        driverA: t.arg.string({ required: true }),
        driverB: t.arg.string({ required: true }),
      },
      resolve: async (shape, args, ctx) => {
        const [idA, idB] = await Promise.all([
          assignmentForCode(ctx, shape, args.driverA),
          assignmentForCode(ctx, shape, args.driverB),
        ]);
        // Null rather than an error: asking about a driver who did not start
        // this race is a question with an answer, and the answer is "neither of
        // them was here".
        if (!idA || !idB || idA === idB) return null;

        const a = sideOf(shape, idA);
        const b = sideOf(shape, idB);

        const positionOf = new Map<string, number>();
        const timeOf = new Map<string, number>();
        for (const row of shape.positions) {
          positionOf.set(`${row.assignmentId}:${row.lap}`, row.position);
          if (row.lapTime != null) timeOf.set(`${row.assignmentId}:${row.lap}`, row.lapTime);
        }

        const everyLap = [...new Set(shape.positions.map((p) => p.lap))].sort((x, y) => x - y);
        const laps = everyLap.map((lap) => {
          const posA = positionOf.get(`${idA}:${lap}`);
          const posB = positionOf.get(`${idB}:${lap}`);
          const timeA = timeOf.get(`${idA}:${lap}`);
          const timeB = timeOf.get(`${idB}:${lap}`);
          return {
            lap,
            positionDelta: posA != null && posB != null ? posA - posB : null,
            timeDelta: timeA != null && timeB != null ? timeA - timeB : null,
          };
        });

        return { a, b, laps };
      },
    }),
  }),
});

/** The three reads the whole subtree is computed from. */
export async function loadAnalysis(ctx: Context, raceId: string): Promise<AnalysisShape> {
  const [positions, stintRows, pitRows, resultRows] = await Promise.all([
    ctx.db.select(positionColumns).from(racePositions)
      .where(eq(racePositions.raceId, raceId))
      .orderBy(asc(racePositions.lap), asc(racePositions.position)),
    ctx.db.select().from(stints)
      .where(eq(stints.raceId, raceId))
      .orderBy(asc(stints.stintNumber)),
    ctx.db.select().from(pitStops)
      .where(eq(pitStops.raceId, raceId))
      .orderBy(asc(pitStops.lap)),
    ctx.db.select().from(raceResults).where(eq(raceResults.raceId, raceId)),
  ]);

  return { raceId, positions, stints: stintRows, pitStops: pitRows, results: resultRows };
}
