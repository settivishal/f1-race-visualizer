import DataLoader from 'dataloader';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  driverTeamAssignments,
  drivers,
  meetings,
  raceResults,
  races,
  teamSeasons,
  teams,
} from '@/db/schema';
import type { Db } from './context';
import { driverColumns, teamColumns, type DriverRow, type TeamRow } from './schema/entity';

type AssignmentRow = typeof driverTeamAssignments.$inferSelect;
type TeamSeasonRow = typeof teamSeasons.$inferSelect;
type MeetingRow = typeof meetings.$inferSelect;
type RaceRow = typeof races.$inferSelect;

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
        // Per-season livery first, the team's standing colour otherwise —
        // the same coalesce seasonPulse uses.
        teamColor: sql<string | null>`coalesce(${teamSeasons.color}, ${teams.color})`,
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
