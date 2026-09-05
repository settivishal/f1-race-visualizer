import type { Lap, Meeting, PositionSample, Session } from './openf1';
import type {
  EventRow, LineupRow, PositionRow, RaceBundle, ResultRow, TransformedRace,
} from './types';

/**
 * The functional core. Every function here takes plain data and returns plain
 * data — no fetch, no db, no Date.now(), no environment. That is what makes
 * the interesting logic testable by calling it with a saved payload, which is
 * precisely the check v1 never had.
 */

const SCORED_SESSIONS = new Set(['Race', 'Sprint']);

export const isScoredSession = (s: Session) => SCORED_SESSIONS.has(s.session_name);

/**
 * OpenF1 publishes no round number, so it is derived: order the meetings that
 * contain a scored session by date, and the round is the index.
 *
 * Pre-season testing meetings have no Race session and must not consume a
 * round, or every number after them is wrong.
 */
export function deriveRounds(meetings: Meeting[], sessions: Session[]): Map<number, number> {
  const racing = new Set(
    sessions.filter((s) => s.session_name === 'Race').map((s) => s.meeting_key),
  );
  const ordered = meetings
    .filter((m) => racing.has(m.meeting_key))
    .sort((a, b) => a.date_start.localeCompare(b.date_start));

  return new Map(ordered.map((m, i) => [m.meeting_key, i + 1]));
}

const slugify = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function raceSlug(session: Session, meeting: Meeting): string {
  const place = slugify(meeting.circuit_short_name ?? meeting.meeting_name);
  return session.session_name === 'Sprint'
    ? `${session.year}-${place}-sprint`
    : `${session.year}-${place}`;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * The join at the heart of the project.
 *
 * `/position` is a timestamped sample stream — a sample arrives when a
 * position changes, so a driver who leads from lights to flag may have one all
 * race. `/laps` is per-lap rows. They are in different coordinate systems.
 *
 * The rule: for each driver-lap, take the last sample at or before the moment
 * that lap was completed. That is "what position was this driver in when they
 * crossed the line", which is what a timing screen shows.
 *
 * What the rule handles without special-casing:
 *   - the leader with one sample — it walks back to the last earlier sample
 *   - a sample belonging to the next lap — excluded by the boundary
 *   - a safety car — no samples arrive, so the order simply holds, which is
 *     correct and is exactly what v1's cumulative-lap-time sort could not do
 *   - a retirement — no lap rows exist afterwards, so no rows are produced.
 *     The retirement itself is recorded from /session_result, not inferred
 *     from this absence
 */
export function buildLapPositions(
  laps: Lap[],
  positions: PositionSample[],
  warnings: string[] = [],
): PositionRow[] {
  const samplesByDriver = new Map<number, PositionSample[]>();
  for (const sample of positions) {
    const list = samplesByDriver.get(sample.driver_number);
    if (list) list.push(sample);
    else samplesByDriver.set(sample.driver_number, [sample]);
  }
  for (const list of samplesByDriver.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
  }

  const lapsByDriver = new Map<number, Lap[]>();
  for (const lap of laps) {
    const list = lapsByDriver.get(lap.driver_number);
    if (list) list.push(lap);
    else lapsByDriver.set(lap.driver_number, [lap]);
  }

  const rows: PositionRow[] = [];

  for (const [driverNumber, driverLaps] of lapsByDriver) {
    driverLaps.sort((a, b) => a.lap_number - b.lap_number);
    const samples = samplesByDriver.get(driverNumber) ?? [];

    if (samples.length === 0) {
      warnings.push(`driver ${driverNumber} has no position samples; ${driverLaps.length} laps produced no rows`);
      continue;
    }

    // Laps are walked in order and samples only move forward, so this is one
    // pass over each rather than a search per lap.
    let cursor = 0;

    for (let i = 0; i < driverLaps.length; i++) {
      const lap = driverLaps[i];
      const boundary = lapBoundary(lap, driverLaps[i + 1]);

      // No boundary means the lap has no end time and no successor to borrow
      // one from, which only happens on a lap the driver never completed — the
      // crash or retirement itself. There is no position at completion because
      // there was no completion, and the retirement is recorded from
      // /session_result rather than guessed at here.
      if (boundary === null) continue;

      while (cursor + 1 < samples.length && ms(samples[cursor + 1].date) <= boundary) cursor++;

      const sample = samples[cursor];
      // A driver whose first lap completes before any sample exists for them
      // falls back to their earliest known position rather than being dropped.
      const position = ms(sample.date) <= boundary ? sample.position : samples[0].position;

      rows.push(toRow(driverNumber, lap, position));
    }
  }

  return rows;
}

/**
 * When this lap was completed, in epoch ms, or null if it never was.
 *
 * `lap_duration` is null for an in-lap, an out-lap, or a lap interrupted by a
 * red flag, so the next lap's start is used as the boundary instead. Both
 * missing means the driver never finished the lap.
 */
function lapBoundary(lap: Lap, next: Lap | undefined): number | null {
  if (lap.date_start && lap.lap_duration != null) {
    return ms(lap.date_start) + lap.lap_duration * 1000;
  }
  if (next?.date_start) return ms(next.date_start);
  return null;
}

const toRow = (driverNumber: number, lap: Lap, position: number): PositionRow => ({
  driverNumber,
  lap: lap.lap_number,
  position,
  // /position and /laps carry no per-lap gap. Null is an honest "not known"
  // rather than a computed guess; /intervals would be the source if it is
  // ever wanted.
  gap: null,
  lapTime: lap.lap_duration,
  sector1: lap.duration_sector_1,
  sector2: lap.duration_sector_2,
  sector3: lap.duration_sector_3,
});

// ── Lineup ────────────────────────────────────────────────────────────

/**
 * Per-session lineups are the point of driver_team_assignments. A driver who
 * changes teams mid-season, or a seat that changes driver, is two different
 * assignments — which is why this is read from each session's own /drivers
 * rather than from a season-wide list.
 */
export function buildLineup(bundle: RaceBundle): LineupRow[] {
  return bundle.drivers
    .filter((d) => d.team_name !== null)
    .map((d) => ({
      driverNumber: d.driver_number,
      code: d.name_acronym,
      name: d.full_name,
      country: d.country_code,
      // Upstream's image URL, recorded as-is. M4 copies the bytes to our own
      // storage and overwrites this; until then the column is honest about
      // where the picture lives.
      headshotUrl: d.headshot_url,
      teamName: d.team_name as string,
      teamColor: d.team_colour ? `#${d.team_colour}` : null,
    }));
}

// ── Results ───────────────────────────────────────────────────────────

/**
 * Points are copied verbatim, never computed. The real number depends on which
 * session it is, the fastest-lap point, stewards' penalties applied after the
 * flag, and half points in a race stopped early. Upstream already reflects all
 * of it. We sum; we do not score.
 */
export function buildResults(bundle: RaceBundle, fastestLapDriver: number | null): ResultRow[] {
  return bundle.results.map((r) => ({
    driverNumber: r.driver_number,
    finalPosition: r.position,
    status: r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : 'FINISHED',
    lapsCompleted: r.number_of_laps ?? 0,
    points: r.points ?? 0,
    fastestLap: r.driver_number === fastestLapDriver,
    // gridPosition is left unset: OpenF1 publishes no starting grid for these
    // seasons, and the column is nullable precisely so an unknown fact can be
    // stored as unknown rather than as a zero.
  }));
}

/** The single quickest valid lap of the session, or null if none is timed. */
export function findFastestLap(laps: Lap[]): { driverNumber: number; lap: number; time: number } | null {
  let best: { driverNumber: number; lap: number; time: number } | null = null;
  for (const lap of laps) {
    if (lap.lap_duration == null) continue;
    if (best === null || lap.lap_duration < best.time) {
      best = { driverNumber: lap.driver_number, lap: lap.lap_number, time: lap.lap_duration };
    }
  }
  return best;
}

// ── Events ────────────────────────────────────────────────────────────

export function buildEvents(bundle: RaceBundle, positions: PositionRow[]): EventRow[] {
  const events: EventRow[] = [];

  for (const pit of bundle.pits) {
    events.push({
      lap: pit.lap_number,
      driverNumber: pit.driver_number,
      type: 'PIT_STOP',
      details: pit.pit_duration != null ? `${pit.pit_duration.toFixed(1)}s in the pit lane` : 'Pit stop',
    });
  }

  // Race-wide events carry no driver. The absence of one is the encoding of
  // "this applies to everyone", rather than inventing a driver to hang it on.
  for (const message of bundle.raceControl) {
    const lap = message.lap_number;
    if (lap == null) continue;

    if (message.category === 'SafetyCar' && /DEPLOYED/i.test(message.message)) {
      events.push({
        lap,
        driverNumber: null,
        type: /VIRTUAL/i.test(message.message) ? 'VIRTUAL_SAFETY_CAR' : 'SAFETY_CAR',
        details: message.message,
      });
    } else if (message.flag === 'RED') {
      events.push({ lap, driverNumber: null, type: 'RED_FLAG', details: message.message });
    }
  }

  for (const result of bundle.results) {
    if (!result.dnf) continue;
    events.push({
      lap: Math.max(1, result.number_of_laps ?? 1),
      driverNumber: result.driver_number,
      type: 'RETIREMENT',
      details: 'Retired',
    });
  }

  const fastest = findFastestLap(bundle.laps);
  if (fastest) {
    events.push({
      lap: fastest.lap,
      driverNumber: fastest.driverNumber,
      type: 'FASTEST_LAP',
      details: `${fastest.time.toFixed(3)}s`,
    });
  }

  events.push(...buildOvertakes(positions));

  return events.sort((a, b) => a.lap - b.lap || a.type.localeCompare(b.type));
}

/**
 * A place gained between one lap and the next. Derived from the position rows
 * rather than from the sample stream, so an overtake means what the replay
 * shows — the running order changed between two laps a viewer can scrub to.
 */
function buildOvertakes(positions: PositionRow[]): EventRow[] {
  const byDriver = new Map<number, PositionRow[]>();
  for (const row of positions) {
    const list = byDriver.get(row.driverNumber);
    if (list) list.push(row);
    else byDriver.set(row.driverNumber, [row]);
  }

  const events: EventRow[] = [];
  for (const [driverNumber, rows] of byDriver) {
    rows.sort((a, b) => a.lap - b.lap);
    for (let i = 1; i < rows.length; i++) {
      const gained = rows[i - 1].position - rows[i].position;
      if (gained <= 0) continue;
      events.push({
        lap: rows[i].lap,
        driverNumber,
        type: 'OVERTAKE',
        details: `P${rows[i - 1].position} to P${rows[i].position}`,
      });
    }
  }
  return events;
}

// ── Assembly ──────────────────────────────────────────────────────────

export function transformRace(bundle: RaceBundle): TransformedRace {
  const warnings: string[] = [];
  const positions = buildLapPositions(bundle.laps, bundle.positions, warnings);
  const fastest = findFastestLap(bundle.laps);

  const lapCount = bundle.laps.reduce((max, lap) => Math.max(max, lap.lap_number), 0);
  if (lapCount === 0) warnings.push(`session ${bundle.session.session_key} has no lap data`);

  return {
    meeting: {
      seasonYear: bundle.session.year,
      round: bundle.round,
      name: bundle.meeting.meeting_name,
      country: bundle.meeting.country_name,
      circuitName: bundle.meeting.circuit_short_name,
      startDate: new Date(bundle.meeting.date_start),
      weather: bundle.weather,
      openf1MeetingKey: bundle.meeting.meeting_key,
    },
    race: {
      type: bundle.session.session_name === 'Sprint' ? 'SPRINT' : 'GRAND_PRIX',
      slug: raceSlug(bundle.session, bundle.meeting),
      date: new Date(bundle.session.date_start),
      laps: lapCount,
      openf1SessionKey: bundle.session.session_key,
    },
    lineup: buildLineup(bundle),
    positions,
    events: buildEvents(bundle, positions),
    results: buildResults(bundle, fastest?.driverNumber ?? null),
    warnings,
  };
}
