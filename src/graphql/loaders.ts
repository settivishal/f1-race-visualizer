import DataLoader from 'dataloader';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  driverTeamAssignments,
  drivers,
  meetings,
  racePredictions,
  raceResults,
  races,
  teamSeasons,
  teams,
} from '@/db/schema';
import type { Db } from './context';
import { careerColumns } from './schema/aggregates';
import type { SeasonRecordShape } from './schema/archive';
import { driverColumns, teamColumns, type DriverRow, type TeamRow, seasonColorSql, withSeasonColor } from './schema/entity';

type AssignmentRow = typeof driverTeamAssignments.$inferSelect;
type TeamSeasonRow = typeof teamSeasons.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
type RaceRow = typeof races.$inferSelect;
export type PredictionRow = typeof racePredictions.$inferSelect;

/**
 * Written by hand rather than through @pothos/plugin-dataloader, deliberately.
 * The plugin would produce working code and teach nothing; the point of the
 * milestone is the mechanism (document 04, Part 5).
 *
 * Two separate ideas are at work:
 *
 *   Batching  — a loader collects every .load(id) made during the current tick
 *               of the event loop and issues ONE query for all of them, so
 *               twenty round trips become one `WHERE id IN (...)`.
 *   Caching   — within one loader instance a key is fetched at most once, so
 *               the sixty requests for the same driver collapse to one.
 *
 * Together they take a race page from ~4,800 statements to ~6, and that number
 * is bounded by the count of entity types rather than the count of rows: a
 * 78-lap Monaco race costs the same as a 15-lap sprint.
 */
function byId<Row extends { id: string }>(db: Db, load: (ids: string[]) => Promise<Row[]>) {
  return new DataLoader<string, Row | null>(async (ids) => {
    const rows = await load([...ids]);
    const found = new Map(rows.map((row) => [row.id, row]));
    // The contract: same length, same order as the keys requested. Postgres
    // returns rows in whatever order it likes and omits ids that matched
    // nothing, so handing its result back directly would give the caller who
    // asked for driver B the row for driver A. That is the classic DataLoader
    // bug, and it produces wrong data rather than an error.
    return ids.map((id) => found.get(id) ?? null);
  });
}

/** One podium line: who finished there and in what colour. */
export type PodiumSlot = { position: number; code: string; teamColor: string | null };

/**
 * The top three of many races in one statement.
 *
 * `Race.results` is a query per race, which is fine for one race page and forty
 * statements for a page of the race library. This joins the way seasonPulse
 * does — assignment to driver to team — and groups in memory, so a page of
 * tiles costs one query no matter how many tiles it has.
 */
function podiumLoader(db: Db) {
  return new DataLoader<string, PodiumSlot[]>(async (raceIds) => {
    const rows = await db
      .select({
        raceId: raceResults.raceId,
        position: raceResults.finalPosition,
        code: drivers.code,
        teamColor: seasonColorSql,
      })
      .from(raceResults)
      .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
      .innerJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
      .leftJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
      .leftJoin(teams, eq(teams.id, teamSeasons.teamId))
      .where(and(inArray(raceResults.raceId, [...raceIds]), lte(raceResults.finalPosition, 3)))
      .orderBy(asc(raceResults.raceId), asc(raceResults.finalPosition));

    const byRace = new Map<string, PodiumSlot[]>();
    for (const row of rows) {
      if (row.position === null) continue;
      const slots = byRace.get(row.raceId) ?? [];
      slots.push({ position: row.position, code: row.code, teamColor: row.teamColor });
      byRace.set(row.raceId, slots);
    }
    // A race nobody has driven has no podium, not a missing one — an empty
    // array is the answer, so the caller never has to branch on status.
    return raceIds.map((id) => byRace.get(id) ?? []);
  });
}

const seasonOf = ({ season, starts, wins, podiums, points, bestFinish }: Omit<SeasonRecordShape, 'team'>) =>
  ({ season, starts, wins, podiums, points, bestFinish });

export type Loaders = ReturnType<typeof createLoaders>;

export function createLoaders(db: Db) {
  return {
    assignmentById: byId<AssignmentRow>(db, (ids) =>
      db.select().from(driverTeamAssignments).where(inArray(driverTeamAssignments.id, ids)),
    ),
    driverById: byId<DriverRow>(db, (ids) =>
      db.select(driverColumns).from(drivers).where(inArray(drivers.id, ids)),
    ),
    teamSeasonById: byId<TeamSeasonRow>(db, (ids) =>
      db.select().from(teamSeasons).where(inArray(teamSeasons.id, ids)),
    ),
    teamById: byId<TeamRow>(db, (ids) =>
      db.select(teamColumns).from(teams).where(inArray(teams.id, ids)),
    ),
    // A page of race tiles asks for one meeting per tile, and a weekend's two
    // sessions share one — so this batches and dedupes both.
    meetingById: byId<MeetingRow>(db, (ids) =>
      db.select().from(meetings).where(inArray(meetings.id, ids)),
    ),
    podiumByRaceId: podiumLoader(db),
    // Careers, season by season, newest first — one query for a profile page
    // and one for the whole index. A driver who changed team mid-season has two
    // rows for that year. They are kept separate rather than merged: "Racing
    // Bulls, then Red Bull" is the fact, and a merged row would have to pick
    // one team and lie.
    careerByDriverId: new DataLoader<string, SeasonRecordShape[]>(async (driverIds) => {
      const rows = await db
        .select({ id: driverTeamAssignments.driverId, ...careerColumns, team: teams, teamColor: teamSeasons.color })
        .from(raceResults)
        .innerJoin(races, eq(races.id, raceResults.raceId))
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
        .where(inArray(driverTeamAssignments.driverId, [...driverIds]))
        .groupBy(driverTeamAssignments.driverId, meetings.seasonYear, teams.id, teamSeasons.color)
        .orderBy(desc(meetings.seasonYear));
      return driverIds.map((id) => rows
        .filter((row) => row.id === id)
        .map((row) => ({ ...seasonOf(row), team: withSeasonColor(row.team, row.teamColor) })));
    }),
    careerByTeamId: new DataLoader<string, SeasonRecordShape[]>(async (teamIds) => {
      const rows = await db
        .select({ id: teamSeasons.teamId, ...careerColumns })
        .from(raceResults)
        .innerJoin(races, eq(races.id, raceResults.raceId))
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .where(inArray(teamSeasons.teamId, [...teamIds]))
        .groupBy(teamSeasons.teamId, meetings.seasonYear)
        .orderBy(desc(meetings.seasonYear));
      return teamIds.map((id) => rows
        .filter((row) => row.id === id)
        .map((row) => ({ ...seasonOf(row), team: null })));
    }),
    // The grands prix held at each circuit, newest first. The circuit index
    // asks for every circuit's history at once; this keeps that one query.
    // Cancelled rounds were never held there, so they are not its history.
    racesByCircuitId: new DataLoader<string, RaceRow[]>(async (circuitIds) => {
      const rows = await db
        .select({ circuitId: meetings.circuitId, race: races })
        .from(races)
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .where(and(
          inArray(meetings.circuitId, [...circuitIds]),
          eq(races.type, 'GRAND_PRIX'),
          ne(races.status, 'CANCELLED'),
        ))
        .orderBy(desc(races.date));
      return circuitIds.map((id) => rows.filter((row) => row.circuitId === id).map((row) => row.race));
    }),
    // Every model version's rows, so the resolver can pick one without a
    // second query. A race has ~22 rows per version; there are few versions.
    predictionsByRaceId: new DataLoader<string, PredictionRow[]>(async (raceIds) => {
      const rows = await db
        .select()
        .from(racePredictions)
        .where(inArray(racePredictions.raceId, [...raceIds]));
      return raceIds.map((id) => rows.filter((row) => row.raceId === id));
    }),
    /**
     * The team a driver most recently raced for, in that season's colour. A
     * prediction is keyed by driver alone, because the race it is for has no
     * lineup yet, so this is the closest fact to "the car they will drive".
     */
    // ponytail: latest team overall, which is right for an upcoming race only; key by race date if past races ever show predictions.
    latestTeamByDriverId: new DataLoader<string, TeamRow | null>(async (driverIds) => {
      const rows = await db
        .selectDistinctOn([driverTeamAssignments.driverId], {
          driverId: driverTeamAssignments.driverId,
          ...teamColumns,
          color: seasonColorSql,
        })
        .from(raceResults)
        .innerJoin(races, eq(races.id, raceResults.raceId))
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
        .where(inArray(driverTeamAssignments.driverId, [...driverIds]))
        .orderBy(driverTeamAssignments.driverId, desc(races.date));
      const byDriver = new Map(rows.map(({ driverId, ...team }) => [driverId, team]));
      return driverIds.map((id) => byDriver.get(id) ?? null);
    }),
    /**
     * The round number F1 publishes: the meeting's place among its season's
     * grands prix that were not cancelled, by date. `meetings.round` is a
     * position in OpenF1's calendar, which keeps the rounds F1 cancelled and
     * renumbered around (2023's Imola, 2026's Bahrain and Jeddah), so it runs
     * ahead of the official number. Computed rather than stored, because a race
     * is cancelled by hand in the admin and the numbers after it move then.
     * Null for a cancelled round, which has no number.
     */
    officialRoundByMeetingId: new DataLoader<string, number | null>(async (meetingIds) => {
      const seasons = db.select({ year: meetings.seasonYear }).from(meetings)
        .where(inArray(meetings.id, [...meetingIds]));
      const rows = await db
        .select({
          meetingId: races.meetingId,
          round: sql<number>`(row_number() over (partition by ${meetings.seasonYear} order by ${races.date}))::int`,
        })
        .from(races)
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .where(and(
          eq(races.type, 'GRAND_PRIX'),
          ne(races.status, 'CANCELLED'),
          inArray(meetings.seasonYear, seasons),
        ));
      const byMeeting = new Map(rows.map((row) => [row.meetingId, row.round]));
      return meetingIds.map((id) => byMeeting.get(id) ?? null);
    }),
    /**
     * When a race weekend starts: midnight at the track on the day of first
     * practice, so it turns over at one moment for every reader. A meeting
     * with no offset (an archive one) falls back to first practice itself.
     */
    weekendStartByMeetingId: new DataLoader<string, Date>(async (meetingIds) => {
      const local = sql`(${meetings.startDate} at time zone 'UTC') + ${meetings.utcOffset}`;
      const rows = await db
        .select({
          meetingId: meetings.id,
          start: sql<Date>`coalesce((date_trunc('day', ${local}) - ${meetings.utcOffset}) at time zone 'UTC', ${meetings.startDate})`
            .mapWith(meetings.startDate),
        })
        .from(meetings)
        .where(inArray(meetings.id, [...meetingIds]));
      const byMeeting = new Map(rows.map((row) => [row.meetingId, row.start]));
      return meetingIds.map((id) => byMeeting.get(id) ?? new Error(`no meeting ${id}`));
    }),
    /**
     * The sprint of a weekend, if it had one. Keyed by meeting rather than by
     * race, because that is the question the library asks: this grand prix's
     * card wants the other session of its own weekend.
     */
    sprintByMeetingId: new DataLoader<string, RaceRow | null>(async (meetingIds) => {
      const rows = await db
        .select()
        .from(races)
        .where(and(inArray(races.meetingId, [...meetingIds]), eq(races.type, 'SPRINT')));
      const byMeeting = new Map(rows.map((row) => [row.meetingId, row]));
      return meetingIds.map((id) => byMeeting.get(id) ?? null);
    }),
  };
}
