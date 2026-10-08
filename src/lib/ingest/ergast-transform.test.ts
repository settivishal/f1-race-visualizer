import { describe, expect, it } from 'vitest';
import laps from './__fixtures__/australia-2018-ergast/laps.json';
import pitStops from './__fixtures__/australia-2018-ergast/pitStops.json';
import race from './__fixtures__/australia-2018-ergast/race.json';
import {
  archiveRaceSlug, buildArchiveEvents, buildArchivePitStops, buildArchivePositions,
  buildArchiveResults, buildNumbersByDriverId,
  classifyResult, parseDuration, transformArchiveRace,
} from './ergast-transform';
import type { ErgastLap, ErgastPitStop, ErgastRace, ErgastResult } from './ergast';

/**
 * The 2018 Australian Grand Prix, from the real Ergast payload.
 *
 * Chosen because its outcome is a matter of public record and its shape is
 * awkward in the ways the archive has to survive: Vettel won it from third on
 * the grid, cars retired mid-race, and its 937 lap timings span ten pages of
 * the lap endpoint — so any race here is also a test of the paging.
 */
const archiveRace = race as unknown as ErgastRace;
const archiveLaps = laps as unknown as ErgastLap[];
const archiveStops = pitStops as unknown as ErgastPitStop[];
const results = archiveRace.Results as ErgastResult[];

describe('parseDuration', () => {
  it('reads a lap time and a pit-stop duration in the same units', () => {
    expect(parseDuration('1:29.345')).toBeCloseTo(89.345, 3);
    expect(parseDuration('22.213')).toBeCloseTo(22.213, 3);
  });

  it('is null rather than zero for a lap upstream never timed', () => {
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe('classifyResult', () => {
  const at = (positionText: string) =>
    classifyResult({ positionText } as ErgastResult);

  it('switches on the token, not on the prose', () => {
    // "+1 Lap" and "Finished" are both classifications; the token says so and
    // the prose does not, which is why the prose is never switched on.
    expect(at('11')).toBe('FINISHED');
    expect(at('R')).toBe('DNF');
    expect(at('D')).toBe('DSQ');
    expect(at('W')).toBe('DNS');
    expect(at('N')).toBe('DNF');
  });
});

describe('driver numbers', () => {
  const numbers = buildNumbersByDriverId(results);

  it('uses the number that was on the car', () => {
    expect(numbers.get('vettel')).toBe(5);
    expect(numbers.get('hamilton')).toBe(44);
  });

  it('gives every classified driver a distinct number', () => {
    expect(numbers.size).toBe(results.length);
    expect(new Set(numbers.values()).size).toBe(results.length);
  });
});

describe('the archive race', () => {
  const transformed = transformArchiveRace(archiveRace, archiveLaps, archiveStops);

  it('slugs the way the OpenF1 path slugs, so one race cannot become two rows', () => {
    // OpenF1 builds "2025-melbourne" from circuit_short_name; Ergast's nearest
    // equivalent is the locality, not "Albert Park Grand Prix Circuit".
    expect(archiveRaceSlug(archiveRace)).toBe('2018-melbourne');
  });

  it('names two races at one place after the races, so neither overwrites the other', () => {
    const at = (raceName: string, locality: string) => ({
      ...archiveRace, season: 2020, raceName,
      Circuit: { ...archiveRace.Circuit, Location: { ...archiveRace.Circuit.Location, locality } },
    });
    const season = [
      at('Bahrain Grand Prix', 'Sakhir'), at('Sakhir Grand Prix', 'Sakhir'),
      at('British Grand Prix', 'Silverstone'), at('70th Anniversary Grand Prix', 'Silverstone'),
      at('Italian Grand Prix', 'Monza'),
    ];
    expect(season.map((race) => archiveRaceSlug(race, season))).toEqual([
      '2020-bahrain', '2020-sakhir', '2020-british', '2020-70th-anniversary', '2020-monza',
    ]);
  });

  it('is marked as the LAPS tier, because that is what this era published', () => {
    expect(transformed.race.dataTier).toBe('LAPS');
    expect(transformed.race.openf1SessionKey).toBeNull();
    expect(transformed.meeting.openf1MeetingKey).toBeNull();
  });

  it('carries the circuit as a place, not just a name', () => {
    expect(transformed.meeting.circuit).toMatchObject({
      ergastCircuitId: 'albert_park',
      locality: 'Melbourne',
      country: 'Australia',
    });
    expect(transformed.meeting.circuit?.latitude).toBeCloseTo(-37.85, 1);
  });

  it('records the result the world already knows', () => {
    const winner = transformed.results.find((r) => r.finalPosition === 1);
    expect(winner?.driverNumber).toBe(5);      // Vettel
    expect(winner?.points).toBe(25);
    // The whole reason Ergast came back: OpenF1 publishes no starting grid.
    expect(winner?.gridPosition).toBe(3);
  });

  it('stores an unclassified driver as a status with no position', () => {
    const retired = transformed.results.filter((r) => r.status === 'DNF');
    expect(retired.length).toBeGreaterThan(0);
    for (const row of retired) expect(row.finalPosition).toBeNull();
  });

  it('produces a running order the database would accept', () => {
    const perLapDriver = new Set<string>();
    const perLapPosition = new Set<string>();
    for (const row of transformed.positions) {
      const driverKey = `${row.lap}:${row.driverNumber}`;
      const positionKey = `${row.lap}:${row.position}`;
      expect(perLapDriver.has(driverKey)).toBe(false);
      expect(perLapPosition.has(positionKey)).toBe(false);
      perLapDriver.add(driverKey);
      perLapPosition.add(positionKey);
    }
  });

  it('keeps every driver on a lap that straddled a page boundary', () => {
    // The lap endpoint pages by timing, not by lap, so a lap can arrive in two
    // pieces. If the client dropped one, some lap here would be short.
    const byLap = new Map<number, number>();
    for (const row of transformed.positions) {
      byLap.set(row.lap, (byLap.get(row.lap) ?? 0) + 1);
    }
    const firstLapCount = byLap.get(1) as number;
    expect(firstLapCount).toBeGreaterThan(15);
    // No lap before the first retirement should be missing cars.
    expect(byLap.get(2)).toBe(firstLapCount);
  });

  it('has lap times but no sectors or gaps, which is what LAPS means', () => {
    const timed = transformed.positions.filter((p) => p.lapTime !== null);
    // 937 is exactly what Ergast reports as the total for this race, so this
    // also says the ten pages of lap timings were stitched without loss.
    expect(timed).toHaveLength(937);
    for (const row of transformed.positions) {
      expect(row.sector1).toBeNull();
      expect(row.gap).toBeNull();
    }
  });

  it('publishes no stints, because the era published none', () => {
    expect(transformed.stints).toEqual([]);
    expect(transformed.pitStops.length).toBeGreaterThan(0);
  });

  it('carries the retirement reason through, where a person reads it', () => {
    const retirements = transformed.events.filter((e) => e.type === 'RETIREMENT');
    expect(retirements.length).toBeGreaterThan(0);
    expect(retirements.every((e) => e.details.length > 0)).toBe(true);
    expect(retirements.some((e) => e.details !== 'Retired')).toBe(true);
  });

  it('marks exactly one fastest lap', () => {
    expect(transformed.results.filter((r) => r.fastestLap)).toHaveLength(1);
    expect(transformed.events.filter((e) => e.type === 'FASTEST_LAP')).toHaveLength(1);
  });
});

describe('positions for a driver with no result row', () => {
  it('are dropped, loudly', () => {
    const warnings: string[] = [];
    const rows = buildArchivePositions(
      [{ number: 1, Timings: [{ driverId: 'ghost', position: 1 }] } as ErgastLap],
      new Map(),
      warnings,
    );
    expect(rows).toEqual([]);
    expect(warnings[0]).toContain('ghost');
  });
});

describe('grid position 0', () => {
  it('is kept, because a pit-lane start is a fact rather than a gap', () => {
    const rows = buildArchiveResults(
      [{
        position: 20, positionText: '20', points: 0, grid: 0, laps: 58,
        status: 'Finished', Driver: { driverId: 'x', givenName: 'A', familyName: 'B' },
        Constructor: { constructorId: 'c', name: 'C' },
      } as ErgastResult],
      new Map([['x', 7]]),
    );
    expect(rows[0].gridPosition).toBe(0);
  });
});

describe('a stop under a red flag', () => {
  // Monza 2021-style: the field waits in the pit lane for half an hour. Ergast
  // files it as a pit stop like any other.
  const stops = [
    { driverId: 'x', lap: 20, stop: 1, duration: '23.4' },
    { driverId: 'x', lap: 31, stop: 2, duration: '30:12.5' },
  ] as ErgastPitStop[];
  const numbers = new Map([['x', 7]]);

  it('is kept as a row, verbatim', () => {
    expect(buildArchivePitStops(stops, numbers).map((row) => row.lap)).toEqual([20, 31]);
  });

  it('is not narrated as a pit stop', () => {
    const events = buildArchiveEvents([], stops, [], numbers).filter((e) => e.type === 'PIT_STOP');
    expect(events).toEqual([
      { lap: 20, driverNumber: 7, type: 'PIT_STOP', details: '23.4s in the pit lane' },
    ]);
  });
});
