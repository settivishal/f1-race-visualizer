import { eq, inArray, sql, type AnyColumn } from 'drizzle-orm';
import { getDb, type Db } from '@/db';
import {
  circuits, driverTeamAssignments, drivers, meetings, pitStops,
  racePositions, raceEvents, raceResults, races, seasons, stints, teamSeasons, teams,
} from '@/db/schema';
import type { TransformedRace } from './types';

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
export async function writeRace(
  race: TransformedRace,
  // Injectable so the two-upstream merge can be tested against PGlite rather
  // than against whatever DATABASE_URL happens to hold.
  db: Db = getDb(),
): Promise<number> {
  return db.transaction(async (tx) => {
    let rows = 0;

    const season = race.meeting.seasonYear;
    await tx.insert(seasons).values({ year: season }).onConflictDoNothing();

    // The circuit, where the source knows one. Ergast does; OpenF1 does not, so
    // an OpenF1 import leaves whatever is already linked alone.
    let circuitId: string | null = null;
    if (race.meeting.circuit) {
      const [circuitRow] = await tx.insert(circuits)
        .values(race.meeting.circuit)
        .onConflictDoUpdate({
          target: circuits.ergastCircuitId,
          set: { ...race.meeting.circuit, updatedAt: new Date() },
        })
        .returning();
      circuitId = circuitRow.id;
    }

    const { circuit: _circuit, ...meetingValues } = race.meeting;

    /**
     * Both upserts conflict on the natural key rather than on an upstream one.
     *
     * A meeting is identified by its season and round, and a race by its slug,
     * in every source. Conflicting on `openf1_meeting_key` instead — as this did
     * — means an archive import, whose key is null, cannot match the row OpenF1
     * already wrote for the same weekend, and inserts a duplicate that trips the
     * (season, round) constraint. The natural key is the one both upstreams
     * agree on, which is what makes them able to meet on the same row.
     */
    const [meetingRow] = await tx.insert(meetings)
      .values({ ...meetingValues, circuitId })
      .onConflictDoUpdate({
        target: [meetings.seasonYear, meetings.round],
        set: {
          name: sqlAdminWins('name', meetings.name, meetings.adminEdited),
          country: sqlAdminWins('country', meetings.country, meetings.adminEdited),
          circuitName: sqlAdminWins('circuit_name', meetings.circuitName, meetings.adminEdited),
          startDate: sqlAdminWins('start_date', meetings.startDate, meetings.adminEdited),
          // Each of these is only known to one source. Coalescing keeps what
          // the other source wrote instead of blanking it on every re-import.
          weather: sqlCoalesce('weather', meetings.weather),
          openf1MeetingKey: sqlCoalesce('openf1_meeting_key', meetings.openf1MeetingKey),
          circuitId: sqlCoalesce('circuit_id', meetings.circuitId),
          updatedAt: new Date(),
        },
      })
      .returning();

    const [raceRow] = await tx.insert(races)
      .values({
        ...race.race,
        meetingId: meetingRow.id,
        status: race.positions.length > 0 ? 'COMPLETED' : 'SCHEDULED',
      })
      .onConflictDoUpdate({
        target: races.slug,
        set: {
          meetingId: meetingRow.id,
          type: race.race.type,
          date: sqlAdminWins('date', races.date, races.adminEdited),
          laps: sqlAdminWins('laps', races.laps, races.adminEdited),
          // Status only ever moves forward. An admin's word wins outright;
          // otherwise an import can promote a race to COMPLETED but never
          // demote one, because a re-import that fetches nothing means upstream
          // is having a bad day, not that a race un-happened.
          status: sql`case
            when 'status' = any(${races.adminEdited}) then ${races.status}
            when excluded."status" = 'COMPLETED' then 'COMPLETED'
            else ${races.status}
          end`,
          dataTier: race.race.dataTier ?? 'FULL',
          openf1SessionKey: sqlCoalesce('openf1_session_key', races.openf1SessionKey),
          ergastRound: sqlCoalesce('ergast_round', races.ergastRound),
          updatedAt: new Date(),
        },
      })
      .returning();

    // OpenF1 reads the livery off the timing feed; the archive guesses it from
    // a lookup table. Only one of those should be allowed to overwrite.
    const liveryIsAuthoritative = (race.race.dataTier ?? 'FULL') === 'FULL';

    // driver_number is upstream's key; assignments are ours. Resolving the two
    // is the only reason the lineup is written before anything that references
    // it, and it is why the transform could stay pure.
    const assignmentByNumber = new Map<number, string>();

    // A team is found by its Ergast id first and by name only without one. The
    // two upstreams name teams differently ("Red Bull Racing", "Red Bull"), and
    // a rebrand changes the name but not the id, so a name match alone would
    // create a second team, or break the id's unique constraint.
    const ids = race.lineup.flatMap((entry) => entry.ergastConstructorId ?? []);
    const storedNameById = new Map(
      ids.length === 0 ? [] : (await tx
        .select({ id: teams.ergastConstructorId, name: teams.name })
        .from(teams)
        .where(inArray(teams.ergastConstructorId, ids)))
        .map((row) => [row.id, row.name]),
    );

    for (const entry of race.lineup) {
      /**
       * Colours and identity keys are coalesced rather than assigned.
       *
       * Which way round the coalesce goes depends on who is writing. OpenF1
       * publishes the actual livery for the seasons it covers, so it wins over
       * whatever is stored. The archive's colours are a hand-maintained map —
       * good enough to make a 2019 chart readable, not good enough to overwrite
       * a colour taken from the timing feed — so there they only fill a gap.
       */
      const [teamRow] = await tx.insert(teams)
        .values({
          name: storedNameById.get(entry.ergastConstructorId ?? null) ?? entry.teamName,
          color: entry.teamColor,
          ergastConstructorId: entry.ergastConstructorId ?? null,
        })
        .onConflictDoUpdate({
          target: teams.name,
          set: {
            color: liveryIsAuthoritative
              ? sqlCoalesce('color', teams.color)
              : sqlPreferStored('color', teams.color),
            ergastConstructorId: sqlCoalesce('ergast_constructor_id', teams.ergastConstructorId),
            updatedAt: new Date(),
          },
        })
        .returning();

      const [teamSeason] = await tx.insert(teamSeasons)
        .values({ seasonYear: race.meeting.seasonYear, teamId: teamRow.id, color: entry.teamColor })
        .onConflictDoUpdate({
          target: [teamSeasons.seasonYear, teamSeasons.teamId],
          set: {
            color: liveryIsAuthoritative
              ? sqlCoalesce('color', teamSeasons.color)
              : sqlPreferStored('color', teamSeasons.color),
          },
        })
        .returning();

      const [driverRow] = await tx.insert(drivers)
        .values({
          code: entry.code, name: entry.name, number: entry.driverNumber,
          numberSeason: season,
          country: entry.country, headshotUrl: entry.headshotUrl,
          ergastDriverId: entry.ergastDriverId ?? null,
        })
        .onConflictDoUpdate({
          target: drivers.code,
          set: {
            name: entry.name, country: entry.country,
            // Numbers change, and the row holds one. Take the incoming number
            // only from a season at least as recent as the one that set the
            // stored value, so importing an older race cannot roll it back.
            number: sqlNewerSeason('number', drivers.number, drivers.numberSeason, season),
            numberSeason: sqlNewerSeason(
              'number_season', drivers.numberSeason, drivers.numberSeason, season,
            ),
            headshotUrl: sqlCoalesce('headshot_url', drivers.headshotUrl),
            ergastDriverId: sqlCoalesce('ergast_driver_id', drivers.ergastDriverId),
            updatedAt: new Date(),
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

    // Same replace-wholesale rule as positions and events, and for the same
    // reason: a re-import that produces fewer stints must not leave the old
    // ones behind, where they would draw a strategy the driver never ran.
    await tx.delete(stints).where(eq(stints.raceId, raceRow.id));
    const stintRows = race.stints
      .filter((s) => assignmentByNumber.has(s.driverNumber))
      .map((s) => ({
        raceId: raceRow.id,
        assignmentId: assignmentFor(s.driverNumber),
        stintNumber: s.stintNumber, lapStart: s.lapStart, lapEnd: s.lapEnd,
        compound: s.compound, tyreAgeAtStart: s.tyreAgeAtStart,
      }));
    for (const chunk of chunked(stintRows, 500)) {
      await tx.insert(stints).values(chunk);
      rows += chunk.length;
    }

    await tx.delete(pitStops).where(eq(pitStops.raceId, raceRow.id));
    const pitRows = race.pitStops
      .filter((p) => assignmentByNumber.has(p.driverNumber))
      .map((p) => ({
        raceId: raceRow.id,
        assignmentId: assignmentFor(p.driverNumber),
        lap: p.lap, durationMs: p.durationMs,
      }));
    for (const chunk of chunked(pitRows, 500)) {
      await tx.insert(pitStops).values(chunk);
      rows += chunk.length;
    }

    const resultRows = race.results.map((r) => ({
      raceId: raceRow.id,
      assignmentId: assignmentFor(r.driverNumber),
      finalPosition: r.finalPosition, status: r.status,
      lapsCompleted: r.lapsCompleted, points: r.points, fastestLap: r.fastestLap,
      gridPosition: r.gridPosition ?? null,
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
            // Only Ergast knows the grid, so an OpenF1 re-import of a race the
            // archive has already filled must leave it alone.
            gridPosition: sqlCoalesce('grid_position', raceResults.gridPosition),
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

/**
 * The incoming value, or the stored one when the incoming value is null.
 *
 * Two upstreams write the same rows and each knows things the other does not —
 * OpenF1 has liveries and session keys, Ergast has grids and circuits. Assigning
 * would mean each import blanking the other's columns, and the site would show
 * whichever ran last. The column reference is needed rather than a bare name
 * because inside ON CONFLICT the unqualified name is ambiguous.
 */
function sqlCoalesce(column: string, stored: AnyColumn) {
  return sql`coalesce(excluded."${sql.raw(column)}", ${stored})`;
}

/**
 * The incoming value, unless an admin has set this column by hand.
 *
 * The site already had an admin editor for a meeting's name, country, circuit
 * and laps — and every edit was silently reverted by the next weekly import,
 * because the upsert assigned those columns. Which made the editor a lie.
 *
 * Upstream is a default, not the truth. It gets a race wrong in ways no feed
 * models: 2026 abandoned two rounds mid-season, and the round that replaced one
 * of them is still filed as "Bahrain Grand Prix" in "Bahrain" while being held
 * at Sepang. Somebody has to be able to say otherwise and have it stick.
 *
 * One array per table rather than an override column beside every field: this
 * protects any column, including ones not written yet, and clearing a field in
 * the admin drops it from the array so upstream takes over again. That is the
 * undo, and it needs no history.
 */
function sqlAdminWins(column: string, stored: AnyColumn, edited: AnyColumn) {
  return sql`case
    when ${sql.raw(`'${column}'`)} = any(${edited}) then ${stored}
    else excluded."${sql.raw(column)}"
  end`;
}

/**
 * The incoming value, but only from a season at least as new as the one that
 * set what is stored. An older import keeps its hands off.
 *
 * `excluded` is the row that failed to insert, so `excluded.number` is what
 * this import is carrying. A null `number_season` means the stored value
 * predates this rule and has no provenance, so the incoming one wins.
 */
function sqlNewerSeason(
  column: string,
  stored: AnyColumn,
  storedSeason: AnyColumn,
  season: number,
) {
  return sql`case
    when ${storedSeason} is null or ${storedSeason} <= ${season}
      then excluded."${sql.raw(column)}"
    else ${stored}
  end`;
}

/** The stored value, or the incoming one where nothing is stored yet. */
function sqlPreferStored(column: string, stored: AnyColumn) {
  return sql`coalesce(${stored}, excluded."${sql.raw(column)}")`;
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
