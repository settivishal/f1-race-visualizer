import DataLoader from 'dataloader';
import { inArray } from 'drizzle-orm';
import { driverTeamAssignments, drivers, teamSeasons, teams } from '@/db/schema';
import type { Db } from './context';

type AssignmentRow = typeof driverTeamAssignments.$inferSelect;
type DriverRow = typeof drivers.$inferSelect;
type TeamSeasonRow = typeof teamSeasons.$inferSelect;
type TeamRow = typeof teams.$inferSelect;

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

export type Loaders = ReturnType<typeof createLoaders>;

export function createLoaders(db: Db) {
  return {
    assignmentById: byId<AssignmentRow>(db, (ids) =>
      db.select().from(driverTeamAssignments).where(inArray(driverTeamAssignments.id, ids)),
    ),
    driverById: byId<DriverRow>(db, (ids) =>
      db.select().from(drivers).where(inArray(drivers.id, ids)),
    ),
    teamSeasonById: byId<TeamSeasonRow>(db, (ids) =>
      db.select().from(teamSeasons).where(inArray(teamSeasons.id, ids)),
    ),
    teamById: byId<TeamRow>(db, (ids) =>
      db.select().from(teams).where(inArray(teams.id, ids)),
    ),
  };
}
