import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  driverTeamAssignments, drivers, ingestRuns, meetings, racePositions,
  raceEvents, raceResults, races, seasons, teamSeasons, teams,
} from '@/db/schema';
import {
  fetchDrivers, fetchLaps, fetchMeetings, fetchPits, fetchPositions,
  fetchRaceControl, fetchSessionResults, fetchSessions, fetchWeather,
} from './openf1';
import { deriveRounds, isScoredSession, transformRace } from './transform';
import type { RaceBundle, TransformedRace } from './types';

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

export async function ingestRace(sessionKey: number): Promise<IngestResult> {
  const db = getDb();

  const [run] = await db.insert(ingestRuns)
    .values({ source: 'openf1', target: String(sessionKey), status: 'RUNNING' })
    .returning();

  try {
    const bundle = await fetchRaceBundle(sessionKey);
    const race = transformRace(bundle);
    const rowsWritten = await writeRace(race);

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

/** Everything one session needs. Nine calls, all paced by the client's throttle. */
export async function fetchRaceBundle(sessionKey: number): Promise<RaceBundle> {
  const [firstSession] = await fetchSessionsByKey(sessionKey);
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

  const [ldrivers, laps, positions, pits, raceControl, results, weather] = await Promise.all([
    fetchDrivers(sessionKey), fetchLaps(sessionKey), fetchPositions(sessionKey),
    fetchPits(sessionKey), fetchRaceControl(sessionKey), fetchSessionResults(sessionKey),
    fetchWeather(sessionKey),
  ]);

  return {
    meeting, session: firstSession, round,
    drivers: ldrivers, laps, positions, pits, raceControl, results, weather,
  };
}

async function fetchSessionsByKey(sessionKey: number) {
  // /sessions has no by-key filter in our client, and the year is unknown
  // until we have the session — so this walks the seasons OpenF1 covers.
  for (const year of [2025, 2024, 2023]) {
    const found = (await fetchSessions(year)).filter((s) => s.session_key === sessionKey);
    if (found.length > 0) return found;
  }
  return [];
}

/**
 * One race, one transaction. Either the whole race is in the database or none
 * of it is.
 *
 * The failure this prevents is a race with 40 of its 60 laps, which renders
 * without error and looks almost right — far harder to notice than a race that
 * is simply absent. Absence is visible; corruption is not.
 *
 * Every write is INSERT … ON CONFLICT DO UPDATE against a unique constraint,
 * so re-running cannot duplicate anything. Notice what is not here: no "have I
 * already imported this session?" lookup, no imported_at flag. Idempotency is a
 * property of the schema, not a behaviour of the code, so there is no check to
 * get wrong.
 */
async function writeRace(race: TransformedRace): Promise<number> {
  const db = getDb();

  return db.transaction(async (tx) => {
    let rows = 0;

    await tx.insert(seasons).values({ year: race.meeting.seasonYear }).onConflictDoNothing();

    const [meetingRow] = await tx.insert(meetings)
      .values(race.meeting)
      .onConflictDoUpdate({
        target: meetings.openf1MeetingKey,
        set: { ...race.meeting, updatedAt: new Date() },
      })
      .returning();

    const [raceRow] = await tx.insert(races)
      .values({ ...race.race, meetingId: meetingRow.id })
      .onConflictDoUpdate({
        target: races.openf1SessionKey,
        set: { ...race.race, meetingId: meetingRow.id, updatedAt: new Date() },
      })
      .returning();

    // driver_number is upstream's key; assignments are ours. Resolving the two
    // is the only reason the lineup is written before anything that references
    // it, and it is why the transform could stay pure.
    const assignmentByNumber = new Map<number, string>();

    for (const entry of race.lineup) {
      const [teamRow] = await tx.insert(teams)
        .values({ name: entry.teamName, color: entry.teamColor })
        .onConflictDoUpdate({
          target: teams.name,
          set: { color: entry.teamColor, updatedAt: new Date() },
        })
        .returning();

      const [teamSeason] = await tx.insert(teamSeasons)
        .values({ seasonYear: race.meeting.seasonYear, teamId: teamRow.id, color: entry.teamColor })
        .onConflictDoUpdate({
          target: [teamSeasons.seasonYear, teamSeasons.teamId],
          set: { color: entry.teamColor },
        })
        .returning();

      const [driverRow] = await tx.insert(drivers)
        .values({
          code: entry.code, name: entry.name, number: entry.driverNumber,
          country: entry.country, headshotUrl: entry.headshotUrl,
        })
        .onConflictDoUpdate({
          target: drivers.code,
          set: {
            name: entry.name, number: entry.driverNumber, country: entry.country,
            headshotUrl: entry.headshotUrl, updatedAt: new Date(),
          },
        })
        .returning();

      const [assignment] = await tx.insert(driverTeamAssignments)
        .values({ teamSeasonId: teamSeason.id, driverId: driverRow.id })
        .onConflictDoUpdate({
          target: [driverTeamAssignments.teamSeasonId, driverTeamAssignments.driverId],
          set: { driverId: driverRow.id },
        })
        .returning();

      assignmentByNumber.set(entry.driverNumber, assignment.id);
      rows++;
    }

    const assignmentFor = (driverNumber: number) => {
      const id = assignmentByNumber.get(driverNumber);
      // A position row for a driver who is not in this session's lineup is a
      // fact we cannot store, and guessing at one would corrupt the replay.
      if (!id) throw new Error(`driver ${driverNumber} has no assignment in this session`);
      return id;
    };

    const positionRows = race.positions.map((p) => ({
      raceId: raceRow.id,
      assignmentId: assignmentFor(p.driverNumber),
      lap: p.lap, position: p.position, gap: p.gap,
      lapTime: p.lapTime, sector1: p.sector1, sector2: p.sector2, sector3: p.sector3,
    }));

    // Replaced wholesale rather than merged. An upsert would leave behind any
    // row the new run no longer produces, and a stale row holding a position
    // the new set assigns to someone else collides on the unique constraint.
    // Atomic because of the transaction, so there is no window with no rows.
    await tx.delete(racePositions).where(eq(racePositions.raceId, raceRow.id));
    for (const chunk of chunked(positionRows, 500)) {
      await tx.insert(racePositions).values(chunk);
      rows += chunk.length;
    }

    // Events have no natural unique key — two overtakes on the same lap by the
    // same driver are legitimately two rows — so the old set is replaced
    // wholesale. Atomic because of the transaction, idempotent because the old
    // rows are gone before the new ones land.
    await tx.delete(raceEvents).where(eq(raceEvents.raceId, raceRow.id));
    const eventRows = race.events.map((e) => ({
      raceId: raceRow.id,
      assignmentId: e.driverNumber === null ? null : assignmentFor(e.driverNumber),
      lap: e.lap, type: e.type, details: e.details,
    }));
    for (const chunk of chunked(eventRows, 500)) {
      await tx.insert(raceEvents).values(chunk);
      rows += chunk.length;
    }

    const resultRows = race.results.map((r) => ({
      raceId: raceRow.id,
      assignmentId: assignmentFor(r.driverNumber),
      finalPosition: r.finalPosition, status: r.status,
      lapsCompleted: r.lapsCompleted, points: r.points, fastestLap: r.fastestLap,
    }));
    if (resultRows.length > 0) {
      await tx.insert(raceResults)
        .values(resultRows)
        .onConflictDoUpdate({
          target: [raceResults.raceId, raceResults.assignmentId],
          set: {
            finalPosition: sqlExcluded('final_position'), status: sqlExcluded('status'),
            lapsCompleted: sqlExcluded('laps_completed'), points: sqlExcluded('points'),
            fastestLap: sqlExcluded('fastest_lap'),
          },
        });
      rows += resultRows.length;
    }

    return rows;
  });
}

/**
 * Refers to the row Postgres was about to insert, inside ON CONFLICT DO UPDATE.
 * Batched upserts need this: a literal would set every conflicting row to the
 * same value, whereas `excluded` is per-row.
 */
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
