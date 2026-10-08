import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { ergastRaceOn, fetchSeasonSchedule } from './ergast';
import type { Db } from '@/db';

const { circuits, meetings, races } = schema;

/**
 * Links a season's meetings to their circuit rows.
 *
 * OpenF1 publishes a circuit name, not an identity, so every meeting it
 * imported (2023 on) had no circuit: race pages showed no length or turns, and
 * a circuit's page listed none of its recent races. Ergast's calendar has the
 * circuit, and the grand prix's date says which meeting it belongs to — by
 * date, never by round, as everywhere the two upstreams meet.
 *
 * Only unlinked meetings, and only ones with a grand prix that was not
 * cancelled: Ergast drops a cancelled round, so asking again would never find
 * it. A season with nothing to link costs one query and no Ergast request.
 */
export async function linkCircuits(db: Db, season: number): Promise<{ linked: number; warnings: string[] }> {
  const unlinked = await db
    .select({ meetingId: meetings.id, slug: races.slug, date: races.date })
    .from(meetings)
    .innerJoin(races, eq(races.meetingId, meetings.id))
    .where(and(
      eq(meetings.seasonYear, season),
      isNull(meetings.circuitId),
      eq(races.type, 'GRAND_PRIX'),
      ne(races.status, 'CANCELLED'),
    ));
  if (unlinked.length === 0) return { linked: 0, warnings: [] };

  const schedule = await fetchSeasonSchedule(season);
  const byDate = new Map(schedule.map((race) => [race.date, race]));

  const warnings: string[] = [];
  const matched = unlinked.flatMap((row) => {
    const race = ergastRaceOn(row.date, byDate);
    if (!race) warnings.push(`${row.slug}: Ergast has no race on ${row.date.toISOString().slice(0, 10)}`);
    return race ? [{ meetingId: row.meetingId, circuit: race.Circuit }] : [];
  });
  if (matched.length === 0) return { linked: 0, warnings };

  // The circuit row may not exist yet (a venue new this season), so it is
  // created from the same answer; an existing one is left as it is.
  await db.insert(circuits).values(matched.map(({ circuit }) => ({
    ergastCircuitId: circuit.circuitId,
    name: circuit.circuitName,
    locality: circuit.Location.locality ?? null,
    country: circuit.Location.country ?? null,
    latitude: circuit.Location.lat ? Number(circuit.Location.lat) : null,
    longitude: circuit.Location.long ? Number(circuit.Location.long) : null,
  }))).onConflictDoNothing();

  const rows = await db
    .select({ id: circuits.id, ergastId: circuits.ergastCircuitId })
    .from(circuits)
    .where(inArray(circuits.ergastCircuitId, matched.map(({ circuit }) => circuit.circuitId)));
  const idOf = new Map(rows.map((row) => [row.ergastId, row.id]));

  for (const { meetingId, circuit } of matched) {
    await db.update(meetings)
      .set({ circuitId: idOf.get(circuit.circuitId), updatedAt: new Date() })
      .where(and(eq(meetings.id, meetingId), isNull(meetings.circuitId)));
  }
  return { linked: matched.length, warnings };
}
