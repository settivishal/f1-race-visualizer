import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import { ingestRuns } from '@/db/schema';
import { ergastRaceOn, fetchRaceLaps, fetchRacePitStops, fetchSeasonResults } from './ergast';
import { transformArchiveRace } from './ergast-transform';
import {
  fetchDrivers, fetchLaps, fetchMeetings, fetchPits, fetchPositions,
  fetchRaceControl, fetchSessionByKey, fetchSessionResults, fetchSessions, fetchStints, fetchWeather,
} from './openf1';
import { deriveRounds, isScoredSession, transformRace, zeroPointResults } from './transform';
import type { RaceBundle, TransformedRace } from './types';
import { writeRace } from './write';

/**
 * The imperative shell. It reads as a sequence of steps rather than a set of
 * branches — fetch, compute, write — with every decision living in the one
 * line that touches nothing.
 */
export type IngestResult = {
  slug: string;
  rowsWritten: number;
  warnings: string[];
};

export async function ingestRace(sessionKey: number, db: Db = getDb()): Promise<IngestResult> {
  return withIngestRun(db, 'openf1', String(sessionKey), async () => {
    const bundle = await fetchRaceBundle(sessionKey);
    const race = transformRace(bundle);
    await repairZeroPoints(race);
    return race;
  });
}

/**
 * One run, recorded. The row is written RUNNING before any work starts, so a
 * function killed mid-import still leaves a trace in /admin/runs.
 */
async function withIngestRun(
  db: Db,
  source: 'openf1' | 'ergast',
  target: string,
  build: () => Promise<TransformedRace>,
): Promise<IngestResult> {
  const [run] = await db.insert(ingestRuns)
    .values({ source, target, status: 'RUNNING' })
    .returning();

  try {
    const race = await build();
    const rowsWritten = await writeRace(race, db);

    await db.update(ingestRuns)
      .set({
        status: 'SUCCESS',
        rowsWritten,
        finishedAt: new Date(),
        // Warnings are recorded on a successful run rather than discarded. A
        // run that succeeded while noticing something is not the same as a
        // clean one, and the difference should be visible later.
        error: race.warnings.length > 0 ? race.warnings.join('\n') : null,
      })
      .where(eq(ingestRuns.id, run.id));

    return { slug: race.race.slug, rowsWritten, warnings: race.warnings };
  } catch (error) {
    await db.update(ingestRuns)
      .set({ status: 'FAILED', finishedAt: new Date(), error: String(error) })
      .where(eq(ingestRuns.id, run.id));
    // Rethrown, never swallowed. A partial import that reports success is
    // strictly worse than a loud failure: the failure gets retried tomorrow,
    // the silence becomes a race page missing 20 laps that nobody notices.
    throw error;
  }
}

/**
 * Points OpenF1 lost, taken from the other upstream rather than scored here.
 *
 * Two 2023 races arrive with the points column zeroed for drivers who plainly
 * scored (see `zeroPointResults`). Ergast has both right and is already a
 * dependency of this file, so the repair is a read of a second source — "we
 * sum; we do not score" still holds. It fires only when such a row exists, so
 * a clean race costs nothing, and it survives a re-import because it runs on
 * the way in rather than as a correction afterwards.
 *
 * Sprints are skipped: Ergast's results endpoint covers the grand prix only.
 */
async function repairZeroPoints(race: TransformedRace): Promise<void> {
  if (race.race.type !== 'GRAND_PRIX') return;
  const suspect = zeroPointResults(race.results);
  if (suspect.length === 0) return;

  // Matched on the date, never the round number. The two upstreams disagree
  // about rounds: our numbering counts 2023's cancelled Imola and Ergast's does
  // not, so every round after it is off by one — which quietly wrote Mexico
  // City's points onto Austin the first time this ran.
  const day = race.race.date.toISOString().slice(0, 10);
  const season = await fetchSeasonResults(race.meeting.seasonYear);
  const archive = ergastRaceOn(race.race.date, new Map(season.map((r) => [r.date, r])));
  // Ergast's per-result `number` is the car number, which is what OpenF1 keys
  // a driver by too.
  const points = new Map(
    (archive?.Results ?? []).map((r) => [Number(r.number), r.points] as const),
  );

  let repaired = 0;
  for (const row of suspect) {
    const scored = points.get(row.driverNumber);
    if (!scored) continue;
    row.points = scored;
    repaired++;
  }
  race.warnings.push(
    archive
      ? `${suspect.length} results scored zero in the points; ${repaired} taken from Ergast`
      : `${suspect.length} results scored zero in the points; Ergast has no race on ${day}`,
  );
}

/**
 * One archive race, from Ergast.
 *
 * The season's results are fetched by the caller and passed in, because a
 * season is one paginated request set for all of its races and re-fetching it
 * per race would multiply a backfill's cost by twenty.
 *
 * Recorded under `source: 'ergast'` so `/admin/runs` shows which upstream wrote
 * what, and so a failed archive race is distinguishable from a failed cron.
 */
export async function ingestArchiveRace(
  season: number,
  round: number,
  seasonRaces?: Awaited<ReturnType<typeof fetchSeasonResults>>,
  db: Db = getDb(),
): Promise<IngestResult> {
  return withIngestRun(db, 'ergast', `${season}-${round}`, async () => {
    const races = seasonRaces ?? (await fetchSeasonResults(season));
    const race = races.find((r) => r.round === round);
    if (!race) throw new Error(`${season} has no round ${round}`);

    const [laps, stops] = await Promise.all([
      fetchRaceLaps(season, round),
      fetchRacePitStops(season, round),
    ]);

    return transformArchiveRace(race, laps, stops, races);
  });
}

/** Everything one session needs. Ten calls, all paced by the client's throttle. */
export async function fetchRaceBundle(sessionKey: number): Promise<RaceBundle> {
  const [firstSession] = await fetchSessionByKey(sessionKey);
  if (!firstSession) throw new Error(`session ${sessionKey} not found`);
  if (!isScoredSession(firstSession)) {
    throw new Error(`session ${sessionKey} is ${firstSession.session_name}, not a scored session`);
  }

  const year = firstSession.year;
  const [allSessions, allMeetings] = await Promise.all([fetchSessions(year), fetchMeetings(year)]);

  const meeting = allMeetings.find((m) => m.meeting_key === firstSession.meeting_key);
  if (!meeting) throw new Error(`meeting ${firstSession.meeting_key} not found`);

  // OpenF1 publishes no round number, so it comes from the season's calendar.
  const round = deriveRounds(allMeetings, allSessions).get(meeting.meeting_key);
  if (round === undefined) throw new Error(`meeting ${meeting.meeting_key} has no race, so no round`);

  const [ldrivers, laps, positions, pits, stintList, raceControl, results, weather] = await Promise.all([
    fetchDrivers(sessionKey), fetchLaps(sessionKey), fetchPositions(sessionKey),
    fetchPits(sessionKey), fetchStints(sessionKey), fetchRaceControl(sessionKey),
    fetchSessionResults(sessionKey), fetchWeather(sessionKey),
  ]);

  return {
    meeting, session: firstSession, round,
    drivers: ldrivers, laps, positions, pits, stints: stintList, raceControl, results, weather,
  };
}

