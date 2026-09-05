import { describe, expect, it } from 'vitest';
import drivers from './__fixtures__/australia-2025/drivers.json';
import bahrainLaps from './__fixtures__/bahrain-2025/laps.json';
import hungaryLaps from './__fixtures__/hungary-2025/laps.json';
import hungaryPositions from './__fixtures__/hungary-2025/positions.json';
import bahrainPositions from './__fixtures__/bahrain-2025/positions.json';
import laps from './__fixtures__/australia-2025/laps.json';
import pits from './__fixtures__/australia-2025/pits.json';
import positions from './__fixtures__/australia-2025/positions.json';
import raceControl from './__fixtures__/australia-2025/raceControl.json';
import results from './__fixtures__/australia-2025/results.json';
import weather from './__fixtures__/australia-2025/weather.json';
import {
  buildLapPositions, buildResults, deriveRounds, findFastestLap, raceSlug, transformRace,
} from './transform';
import type { Lap, Meeting, PositionSample, Session } from './openf1';
import type { RaceBundle } from './types';

const meeting: Meeting = {
  meeting_key: 1254,
  meeting_name: 'Australian Grand Prix',
  country_name: 'Australia',
  circuit_short_name: 'Melbourne',
  date_start: '2025-03-14T01:30:00+00:00',
  year: 2025,
};

const session: Session = {
  session_key: 9693,
  meeting_key: 1254,
  session_name: 'Race',
  session_type: 'Race',
  date_start: '2025-03-16T04:00:00+00:00',
  date_end: '2025-03-16T06:00:00+00:00',
  year: 2025,
  circuit_short_name: 'Melbourne',
  country_name: 'Australia',
};

const bundle: RaceBundle = {
  meeting,
  session,
  round: 1,
  drivers,
  laps: laps as Lap[],
  positions: positions as PositionSample[],
  pits,
  raceControl,
  results,
  weather,
};

describe('the /position ↔ /laps join, against the real Australian GP 2025', () => {
  const rows = transformRace(bundle).positions;

  it('produces a running order that the database would accept', () => {
    // These are the two unique constraints on race_positions. Asserting them
    // here means a transform bug fails in a test rather than aborting an
    // ingest transaction — same invariant, cheaper feedback.
    const perLapDriver = new Set<string>();
    const perLapPosition = new Set<string>();

    for (const row of rows) {
      const driverKey = `${row.lap}:${row.driverNumber}`;
      const positionKey = `${row.lap}:${row.position}`;
      expect(perLapDriver.has(driverKey), `driver twice on lap ${row.lap}`).toBe(false);
      expect(perLapPosition.has(positionKey), `position ${row.position} twice on lap ${row.lap}`).toBe(false);
      perLapDriver.add(driverKey);
      perLapPosition.add(positionKey);
    }
  });

  it('gives every lap a strictly increasing order with no repeats', () => {
    // Contiguity is deliberately not asserted, and the database does not
    // require it either. A driver running at the leader's crossing who never
    // completes that lap leaves their place empty — Australia lap 1 has no P10
    // because that car was out. A hole is honest; a duplicate is a bug.
    const byLap = new Map<number, number[]>();
    for (const row of rows) {
      byLap.set(row.lap, [...(byLap.get(row.lap) ?? []), row.position]);
    }

    for (const [lap, ordered] of byLap) {
      const sorted = [...ordered].sort((a, b) => a - b);
      expect(new Set(sorted).size, `lap ${lap} repeats a position`).toBe(sorted.length);
      expect(sorted[0], `lap ${lap} starts below P1`).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the field intact under the safety car', () => {
    // A safety car was deployed on lap 34 and came in on lap 41. Positions do
    // not change behind it, so no samples arrive and the order simply holds.
    // This is the case v1's cumulative-lap-time sort turned into phantom
    // overtakes, because a car at the back of the queue loses fractions more
    // than the leader.
    const order = (lap: number) =>
      rows.filter((r) => r.lap === lap).sort((a, b) => a.position - b.position)
        .map((r) => r.driverNumber);

    expect(order(36)).toEqual(order(35));
  });

  it('stops producing rows for a driver once they retire', () => {
    // Alonso (14) retired having completed 32 laps.
    const alonso = rows.filter((r) => r.driverNumber === 14).map((r) => r.lap);
    expect(Math.max(...alonso)).toBeLessThanOrEqual(33);

    // The retirement itself is a fact from /session_result, never inferred
    // from this absence — that inference is exactly what v1 got wrong.
    const result = transformRace(bundle).results.find((r) => r.driverNumber === 14);
    expect(result?.status).toBe('DNF');
    expect(result?.lapsCompleted).toBe(32);
  });

  it('emits no row for a lap the driver never completed', () => {
    // Alonso (14) crashed on lap 33: that lap has a null duration and there is
    // no lap 34 to bound it, so he never crossed the line. An earlier version
    // carried his lap-32 position forward, which collided with Antonelli (12),
    // who genuinely held P10 on that lap — and the collision is only a symptom.
    // There is no position at completion because there was no completion.
    const alonsoLap33 = rows.find((r) => r.driverNumber === 14 && r.lap === 33);
    expect(alonsoLap33).toBeUndefined();

    // Antonelli (12) was the driver his carried-forward place collided with.
    // The position he holds is not asserted here — that is the running order's
    // business, checked as an invariant above rather than pinned to a number.
    expect(rows.find((r) => r.driverNumber === 12 && r.lap === 33)).toBeDefined();
  });

  it('has null durations only on terminal laps in this race', () => {
    // All seven null-duration laps here belong to a driver's final lap, so all
    // seven are legitimately dropped. The mid-race case — where the next lap's
    // start supplies the boundary — has no example in this fixture and is
    // covered synthetically below. A red-flagged race would exercise it for
    // real, and is the next fixture worth capturing.
    const nullDuration = (laps as Lap[]).filter((l) => l.lap_duration == null);
    expect(nullDuration).toHaveLength(7);

    for (const lap of nullDuration) {
      const hasNext = (laps as Lap[]).some(
        (x) => x.driver_number === lap.driver_number && x.lap_number === lap.lap_number + 1,
      );
      expect(hasNext, `lap ${lap.lap_number} for driver ${lap.driver_number} is not terminal`).toBe(false);
      expect(rows.find((r) => r.driverNumber === lap.driver_number && r.lap === lap.lap_number)).toBeUndefined();
    }
  });

});

describe('a place changing at the line — Bahrain 2025', () => {
  const rows = buildLapPositions(bahrainLaps as Lap[], bahrainPositions as PositionSample[]);

  it('gives lap 37 one second place, not two', () => {
    // The race that broke the first version of the join. Russell (63) crossed
    // the line still P2 at 16:07:25.751; Leclerc (16) crossed two seconds later
    // already P2, having passed him on the way. Reading each driver at their
    // own crossing time made both true and the lap unstorable.
    const lap37 = rows.filter((r) => r.lap === 37);
    const seconds = lap37.filter((r) => r.position === 2);
    expect(seconds).toHaveLength(1);
    expect(seconds[0].driverNumber).toBe(63);
  });

  it('has no repeated position on any lap', () => {
    const byLap = new Map<number, number[]>();
    for (const row of rows) byLap.set(row.lap, [...(byLap.get(row.lap) ?? []), row.position]);
    for (const [lap, ordered] of byLap) {
      expect(new Set(ordered).size, `lap ${lap} repeats a position`).toBe(ordered.length);
    }
  });
});

describe('an upstream contradiction — Hungary 2025', () => {
  it('resolves two drivers reported in one place, and says so', () => {
    // Upstream reports Hamilton (44) P15 at 14:02:04.000 and Gasly (10) P15 at
    // 14:02:04.543, and Hamilton's next sample four minutes later still says
    // P15. No choice of instant resolves that — the feed contradicts itself.
    // A lap cannot hold two fifteenth places, so the more recently sampled
    // driver keeps it and the other moves to the next free one.
    const warnings: string[] = [];
    const rows = buildLapPositions(hungaryLaps as Lap[], hungaryPositions as PositionSample[], warnings);

    const byLap = new Map<number, number[]>();
    for (const row of rows) byLap.set(row.lap, [...(byLap.get(row.lap) ?? []), row.position]);
    for (const [lap, ordered] of byLap) {
      expect(new Set(ordered).size, `lap ${lap} repeats a position`).toBe(ordered.length);
    }

    // Never silently. Every adjustment is named so it reaches ingest_runs.
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('both in P15'))).toBe(true);
  });
});

describe('buildLapPositions', () => {
  const lap = (driver: number, n: number, start: string, duration: number | null): Lap => ({
    driver_number: driver, lap_number: n, date_start: start, lap_duration: duration,
    duration_sector_1: null, duration_sector_2: null, duration_sector_3: null, is_pit_out_lap: false,
  });
  const sample = (driver: number, position: number, date: string): PositionSample =>
    ({ driver_number: driver, position, date });

  it('takes the last sample at or before the lap ended, not the next one', () => {
    const rows = buildLapPositions(
      [lap(1, 30, '2025-01-01T18:13:41.000Z', 92.4)],
      [
        sample(1, 4, '2025-01-01T18:02:11.000Z'),
        sample(1, 3, '2025-01-01T18:14:22.000Z'), // inside the lap
        sample(1, 2, '2025-01-01T18:16:03.000Z'), // belongs to lap 31
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(3);
  });

  it('holds position for a leader with a single sample all race', () => {
    const rows = buildLapPositions(
      [1, 2, 3].map((n) => lap(1, n, `2025-01-01T18:0${n}:00.000Z`, 60)),
      [sample(1, 1, '2025-01-01T17:59:00.000Z')],
    );
    expect(rows.map((r) => r.position)).toEqual([1, 1, 1]);
  });

  it('falls back to the earliest known position rather than dropping a lap', () => {
    // The only sample arrives after lap 1 was already complete.
    const rows = buildLapPositions(
      [lap(1, 1, '2025-01-01T18:00:00.000Z', 60)],
      [sample(1, 7, '2025-01-01T18:05:00.000Z')],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].position).toBe(7);
  });

  it('uses the next lap start when a duration is missing', () => {
    const rows = buildLapPositions(
      [lap(1, 1, '2025-01-01T18:00:00.000Z', null), lap(1, 2, '2025-01-01T18:02:00.000Z', 60)],
      [sample(1, 5, '2025-01-01T17:59:00.000Z'), sample(1, 4, '2025-01-01T18:01:00.000Z')],
    );
    // Lap 1 is bounded by lap 2's start, so the 18:01 sample counts.
    expect(rows[0]).toMatchObject({ lap: 1, position: 4 });
  });

  it('warns rather than silently dropping a driver with no samples', () => {
    const warnings: string[] = [];
    const rows = buildLapPositions([lap(99, 1, '2025-01-01T18:00:00.000Z', 60)], [], warnings);
    expect(rows).toHaveLength(0);
    expect(warnings[0]).toContain('driver 99');
  });

  it('tolerates non-contiguous lap numbers after a red flag', () => {
    const rows = buildLapPositions(
      [lap(1, 5, '2025-01-01T18:00:00.000Z', 60), lap(1, 9, '2025-01-01T18:40:00.000Z', 60)],
      [sample(1, 2, '2025-01-01T17:59:00.000Z')],
    );
    expect(rows.map((r) => r.lap)).toEqual([5, 9]);
  });
});

describe('derived facts OpenF1 does not publish', () => {
  it('numbers rounds by date, skipping meetings with no race', () => {
    const meetings: Meeting[] = [
      { ...meeting, meeting_key: 1, date_start: '2025-02-26T00:00:00+00:00' }, // testing
      { ...meeting, meeting_key: 2, date_start: '2025-03-14T00:00:00+00:00' },
      { ...meeting, meeting_key: 3, date_start: '2025-03-21T00:00:00+00:00' },
    ];
    const sessions = [
      { ...session, meeting_key: 1, session_name: 'Day 1' },
      { ...session, meeting_key: 2, session_name: 'Race' },
      { ...session, meeting_key: 3, session_name: 'Race' },
    ];

    const rounds = deriveRounds(meetings, sessions);
    expect(rounds.get(1)).toBeUndefined();
    expect(rounds.get(2)).toBe(1);
    expect(rounds.get(3)).toBe(2);
  });

  it('gives a sprint its own slug so both sessions of a weekend can coexist', () => {
    expect(raceSlug(session, meeting)).toBe('2025-melbourne');
    expect(raceSlug({ ...session, session_name: 'Sprint' }, meeting)).toBe('2025-melbourne-sprint');
  });

  it('marks the fastest lap from /laps, since the result carries no such field', () => {
    const fastest = findFastestLap(laps as Lap[]);
    expect(fastest).not.toBeNull();

    const marked = buildResults(bundle, fastest!.driverNumber).filter((r) => r.fastestLap);
    expect(marked).toHaveLength(1);
  });
});

describe('results', () => {
  const rows = transformRace(bundle).results;

  it('records the classification upstream reported, without recomputing it', () => {
    const winner = rows.find((r) => r.finalPosition === 1);
    expect(winner?.driverNumber).toBe(4); // Norris
    expect(winner?.points).toBe(25);
  });

  it('stores an unclassified driver as a status, not as a missing row', () => {
    // Five DNFs and one DNS. v1 had nowhere to put this and inferred it from
    // absent position rows, which cannot distinguish a retirement from an
    // import that dropped the later laps.
    expect(rows.filter((r) => r.status === 'DNF')).toHaveLength(5);
    expect(rows.filter((r) => r.status === 'DNS')).toHaveLength(1);
    for (const row of rows.filter((r) => r.status !== 'FINISHED')) {
      expect(row.finalPosition).toBeNull();
    }
  });
});
