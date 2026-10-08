import { formatDriverName } from '@/lib/format-name';
import type { ErgastLap, ErgastPitStop, ErgastRace, ErgastResult } from './ergast';
import { buildOvertakes, byLapThenType, pitStopEvents, pitStopRows, slugify, type Stop } from './events';
import type {
  EventRow, LineupRow, PitStopRow, PositionRow, ResultRow, TransformedRace,
} from './types';

/**
 * Ergast's shape, turned into the same rows the OpenF1 transform produces.
 *
 * Pure, like `transform.ts`, and for the same reason: this is where an archive
 * race becomes a replay, and the way to know it is right is to call it with a
 * saved payload from a race whose outcome is a matter of public record.
 *
 * What it cannot produce is as important as what it can. Ergast publishes no
 * sector times, no gap strings, no race control messages and no tyre stints, so
 * those come out null and empty — which is what `data_tier: LAPS` on the race
 * row exists to say. What it publishes and OpenF1 does not is the starting
 * grid, which finally fills a column that has been empty since M1.
 */

/**
 * Team colours, by Ergast constructor id.
 *
 * A hand-maintained overlay for the same reason the circuit dimensions are one:
 * Ergast publishes no livery, and every chart on the site is coloured by team.
 * Without this an archive race renders as twenty grey lines, which is not a
 * replay of anything. Constructors that still exist keep the colour the OpenF1
 * ingest already stores; these are the ones that stopped existing before 2023,
 * plus the names the current teams raced under inside the 2018-2022 window.
 */
const CONSTRUCTOR_COLOR: Record<string, string> = {
  mercedes: '#00D7B6',
  ferrari: '#ED1131',
  red_bull: '#4781D7',
  mclaren: '#F47600',
  alpine: '#00A1E8',
  aston_martin: '#229971',
  williams: '#1868DB',
  haas: '#9C9FA2',
  sauber: '#01C00E',
  rb: '#6C98FF',
  alphatauri: '#20394C',
  toro_rosso: '#469BFF',
  racing_point: '#F596C8',
  renault: '#FFF500',
  force_india: '#FF80C7',
  alfa: '#900000',
  lotus_f1: '#FFB800',
  manor: '#323232',
};

/**
 * The same slug the OpenF1 path produces, so the two upstreams cannot create
 * two rows for one race.
 *
 * OpenF1 builds it from `circuit_short_name` — "Melbourne", "Monza" — and
 * Ergast's nearest equivalent is the circuit's locality, not the circuit's
 * name: "Albert Park Grand Prix Circuit" would give `2018-albert-park-grand-
 * prix-circuit` where 2025 has `2025-melbourne`.
 */
export function archiveRaceSlug(race: ErgastRace, season: ErgastRace[] = [race]): string {
  const placeOf = (r: ErgastRace) => r.Circuit.Location.locality ?? r.Circuit.circuitId;
  // 2020 and 2021 ran two races at one place — Spielberg, Silverstone, Sakhir —
  // and the locality alone made them one slug: the second import overwrote the
  // first. Those races go by their own name instead ("2021-styrian",
  // "2020-70th-anniversary"); every other race keeps the slug OpenF1 would give.
  const shared = season.filter((r) => placeOf(r) === placeOf(race)).length > 1;
  const place = shared ? race.raceName.replace(/ Grand Prix$/, '') : placeOf(race);
  return `${race.season}-${slugify(place)}`;
}

/** `1:29.345` or `29.345` into seconds. Null for anything unparseable. */
export function parseDuration(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(':');
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Ergast's `positionText` into our status enum.
 *
 * `status` is prose — "Finished", "+1 Lap", "Engine", "Collision damage" — and
 * switching on prose is how a new phrase upstream silently becomes a finisher.
 * `positionText` is a token: a number, or R/D/W/E/F/N.
 */
export function classifyResult(result: ErgastResult): ResultRow['status'] {
  switch (result.positionText) {
    case 'D':
    case 'E':
      return 'DSQ';
    case 'W':
    case 'F':
      return 'DNS';
    case 'R':
    case 'N':
      return 'DNF';
    default:
      // A number in positionText is a classification. "+1 Lap" and "+2 Laps"
      // are finishers here, which is what the published results say too.
      return Number.isFinite(Number(result.positionText)) ? 'FINISHED' : 'DNF';
  }
}

/**
 * Driver numbers, which are the key every downstream row is written against.
 *
 * Ergast gives a `number` per result and a `permanentNumber` per driver, and
 * they disagree: the permanent number is the one the driver owns, the result's
 * is what was on the car that day. The car number is the right one — it is what
 * the timing screens showed — and a driver with neither gets a synthetic number
 * from their position, high enough not to collide with a real one.
 */
export function buildNumbersByDriverId(results: ErgastResult[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const taken = new Set<number>();

  for (const result of results) {
    const declared = Number(result.number ?? result.Driver.permanentNumber);
    if (Number.isFinite(declared) && declared > 0 && !taken.has(declared)) {
      numbers.set(result.Driver.driverId, declared);
      taken.add(declared);
    }
  }

  let synthetic = 900;
  for (const result of results) {
    if (numbers.has(result.Driver.driverId)) continue;
    while (taken.has(synthetic)) synthetic++;
    numbers.set(result.Driver.driverId, synthetic);
    taken.add(synthetic);
  }
  return numbers;
}

export function buildArchiveLineup(
  results: ErgastResult[],
  numbers: Map<string, number>,
): LineupRow[] {
  return results.map((result) => {
    const driver = result.Driver;
    return {
      driverNumber: numbers.get(driver.driverId) as number,
      // Ergast omits the code for some drivers; the first three letters of the
      // surname is the convention the sport itself used before codes existed.
      code: (driver.code ?? driver.familyName.slice(0, 3)).toUpperCase(),
      name: formatDriverName(`${driver.givenName} ${driver.familyName}`),
      country: driver.nationality ?? null,
      headshotUrl: null,
      teamName: result.Constructor.name,
      teamColor: CONSTRUCTOR_COLOR[result.Constructor.constructorId] ?? null,
      ergastDriverId: driver.driverId,
      ergastConstructorId: result.Constructor.constructorId,
    };
  });
}

/**
 * The running order per lap — the thing the whole archive exists for.
 *
 * No join is needed here, unlike the OpenF1 path: Ergast publishes the order
 * directly, one entry per driver per lap, already agreed with itself. Sectors
 * and gaps are null because the era published none.
 */
export function buildArchivePositions(
  laps: ErgastLap[],
  numbers: Map<string, number>,
  warnings: string[] = [],
): PositionRow[] {
  const rows: PositionRow[] = [];
  const unknown = new Set<string>();

  for (const lap of laps) {
    for (const timing of lap.Timings) {
      const driverNumber = numbers.get(timing.driverId);
      if (driverNumber === undefined) {
        // A lap row for someone with no result row cannot be stored: the write
        // path resolves a driver through the lineup, and inventing one would
        // put a car in the replay that was never classified.
        unknown.add(timing.driverId);
        continue;
      }
      rows.push({
        driverNumber,
        lap: lap.number,
        position: timing.position,
        gap: null,
        lapTime: parseDuration(timing.time),
        sector1: null,
        sector2: null,
        sector3: null,
      });
    }
  }

  for (const driverId of unknown) {
    warnings.push(`lap timings for ${driverId}, who has no result row`);
  }
  return rows;
}

export function buildArchiveResults(
  results: ErgastResult[],
  numbers: Map<string, number>,
): ResultRow[] {
  return results.map((result) => ({
    driverNumber: numbers.get(result.Driver.driverId) as number,
    // Ergast keeps a finishing position for retirements too — 'R' with a
    // position of 18. Only a classified driver gets one here, which is what
    // the rest of the schema already assumes.
    finalPosition: /^\d+$/.test(result.positionText) ? result.position : null,
    status: classifyResult(result),
    lapsCompleted: result.laps,
    points: result.points,
    fastestLap: result.FastestLap?.rank === '1',
    // The whole reason Ergast is back. Grid 0 means a pit-lane start, which is
    // a fact rather than a missing value, so it is kept as 0.
    gridPosition: result.grid,
  }));
}

/** Ergast's stops, in the shape both upstreams share; unknown drivers dropped. */
function stopsOf(stops: ErgastPitStop[], numbers: Map<string, number>): Stop[] {
  return stops.flatMap((stop) => {
    const driverNumber = numbers.get(stop.driverId);
    return driverNumber === undefined
      ? []
      : [{ driverNumber, lap: stop.lap, seconds: parseDuration(stop.duration) }];
  });
}

export const buildArchivePitStops = (stops: ErgastPitStop[], numbers: Map<string, number>): PitStopRow[] =>
  pitStopRows(stopsOf(stops, numbers));

/**
 * Events, from what this era actually says.
 *
 * There is no race control feed before 2023, so there are no safety cars and no
 * red flags here — an absence the story panel reads as a green race, which is
 * wrong but silent, and better than inventing a caution that may not have
 * happened. Retirements, pit stops, the fastest lap and overtakes derived from
 * the running order are all genuinely available.
 */
export function buildArchiveEvents(
  results: ErgastResult[],
  stops: ErgastPitStop[],
  positions: PositionRow[],
  numbers: Map<string, number>,
): EventRow[] {
  const events: EventRow[] = [];

  events.push(...pitStopEvents(stopsOf(stops, numbers)));

  for (const result of results) {
    const status = classifyResult(result);
    if (status !== 'DNF') continue;
    events.push({
      lap: Math.max(1, result.laps),
      driverNumber: numbers.get(result.Driver.driverId) as number,
      type: 'RETIREMENT',
      // Ergast's prose is worth keeping *here*, where it is shown to a person
      // rather than switched on: "Engine" says more than "Retired".
      details: result.status,
    });
  }

  const fastest = results.find((r) => r.FastestLap?.rank === '1');
  if (fastest?.FastestLap?.lap) {
    events.push({
      lap: Number(fastest.FastestLap.lap),
      driverNumber: numbers.get(fastest.Driver.driverId) as number,
      type: 'FASTEST_LAP',
      details: 'Fastest lap',
    });
  }

  events.push(...buildOvertakes(positions));

  return events.sort(byLapThenType);
}

/** One archive race, in the same shape the writer already knows how to store. */
export function transformArchiveRace(
  race: ErgastRace,
  laps: ErgastLap[],
  stops: ErgastPitStop[],
  /** The rest of the season, which decides whether the race's place is shared. */
  season: ErgastRace[] = [race],
): TransformedRace {
  const warnings: string[] = [];
  const results = race.Results ?? [];
  if (results.length === 0) warnings.push(`round ${race.round} has no results`);

  const numbers = buildNumbersByDriverId(results);
  const positions = buildArchivePositions(laps, numbers, warnings);

  const lapCount = laps.reduce((max, lap) => Math.max(max, lap.number), 0);
  if (lapCount === 0) {
    // Pre-1996 seasons publish results and no laps at all. Inside the 2018+
    // window this means the import ran against a race Ergast has not finished
    // publishing, which is worth saying out loud rather than storing as a race
    // with a zero-lap replay.
    warnings.push(`round ${race.round} has no lap data`);
  }

  return {
    meeting: {
      seasonYear: race.season,
      round: race.round,
      name: race.raceName,
      country: race.Circuit.Location.country ?? 'Unknown',
      circuitName: race.Circuit.circuitName,
      startDate: new Date(`${race.date}T${race.time ?? '00:00:00Z'}`),
      utcOffset: null,
      weather: null,
      openf1MeetingKey: null,
      circuit: {
        ergastCircuitId: race.Circuit.circuitId,
        name: race.Circuit.circuitName,
        locality: race.Circuit.Location.locality ?? null,
        country: race.Circuit.Location.country ?? null,
        latitude: race.Circuit.Location.lat ? Number(race.Circuit.Location.lat) : null,
        longitude: race.Circuit.Location.long ? Number(race.Circuit.Location.long) : null,
      },
    },
    race: {
      // Ergast's results endpoint covers the grand prix only. A sprint is a
      // separate endpoint and a separate import; until then the archive is
      // grands prix, which is what the standings countback counts anyway.
      type: 'GRAND_PRIX',
      slug: archiveRaceSlug(race, season),
      date: new Date(`${race.date}T${race.time ?? '00:00:00Z'}`),
      laps: lapCount || Math.max(0, ...results.map((r) => r.laps)),
      openf1SessionKey: null,
      dataTier: 'LAPS',
      ergastRound: race.round,
    },
    lineup: buildArchiveLineup(results, numbers),
    positions,
    events: buildArchiveEvents(results, stops, positions, numbers),
    results: buildArchiveResults(results, numbers),
    // Neither is published before 2023. Empty, not absent: the writer replaces
    // both wholesale, so a re-import of a race that once had stints clears them.
    stints: [],
    pitStops: buildArchivePitStops(stops, numbers),
    warnings,
  };
}
