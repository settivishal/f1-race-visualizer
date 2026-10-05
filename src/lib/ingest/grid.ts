import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { ergastRaceOn, fetchSeasonResults } from './ergast';
import type { Db } from './run';

const { drivers, driverTeamAssignments, meetings, raceResults, races } = schema;

/**
 * Starting grids for the races OpenF1 imported, which publishes none.
 *
 * An update of `grid_position` and nothing else, rather than a read on the
 * import path: the cron imports a race twelve hours after it ends, Ergast is
 * not always caught up by then, and a completed race is never imported again —
 * so a grid missed at import would stay missed. Run on its own, it is retried
 * by every cron until Ergast has the race, and filling 2023–2026 costs one
 * Ergast season per year instead of re-importing every lap of every race.
 *
 * Only blank cells are written. A season with none costs one query and no
 * Ergast request. Ergast's grid goes in as published: 0 is a pit-lane start,
 * as in the archive import.
 */
export async function fillGrids(
  db: Db,
  season: number,
  { since }: { since?: Date } = {},
): Promise<{ filled: number; warnings: string[] }> {
  const blank = await db
    .select({
      raceId: races.id,
      slug: races.slug,
      date: races.date,
      assignmentId: raceResults.assignmentId,
      code: drivers.code,
    })
    .from(raceResults)
    .innerJoin(races, eq(races.id, raceResults.raceId))
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
    .innerJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
    .where(and(
      eq(meetings.seasonYear, season),
      // Ergast's results endpoint covers the grand prix only.
      eq(races.type, 'GRAND_PRIX'),
      eq(races.status, 'COMPLETED'),
      isNull(raceResults.gridPosition),
      since ? gte(races.date, since) : undefined,
    ));
  if (blank.length === 0) return { filled: 0, warnings: [] };

  const archive = await fetchSeasonResults(season);
  const byDate = new Map(archive.map((race) => [race.date, race]));

  const warnings: string[] = [];
  const updates: { raceId: string; assignmentId: string; grid: number }[] = [];
  const grids = new Map<string, Map<string, number> | undefined>();

  for (const row of blank) {
    if (!grids.has(row.raceId)) {
      const race = ergastRaceOn(row.date, byDate);
      if (!race) warnings.push(`${row.slug}: Ergast has no race on ${row.date.toISOString().slice(0, 10)} yet`);
      grids.set(row.raceId, race && new Map(
        (race.Results ?? []).flatMap((r) => (r.Driver.code ? [[r.Driver.code, r.grid] as const] : [])),
      ));
    }
    const byCode = grids.get(row.raceId);
    if (!byCode) continue;
    const grid = byCode.get(row.code);
    if (grid === undefined) warnings.push(`${row.slug}: ${row.code} is not in Ergast's results`);
    else updates.push({ raceId: row.raceId, assignmentId: row.assignmentId, grid });
  }
  if (updates.length === 0) return { filled: 0, warnings };

  const values = sql.join(
    updates.map((u) => sql`(${u.raceId}::uuid, ${u.assignmentId}::uuid, ${u.grid}::int)`),
    sql`, `,
  );
  await db.execute(sql`
    update ${raceResults} set grid_position = v.grid
    from (values ${values}) as v(race_id, assignment_id, grid)
    where ${raceResults.raceId} = v.race_id
      and ${raceResults.assignmentId} = v.assignment_id
      and ${raceResults.gridPosition} is null`);

  return { filled: updates.length, warnings };
}
