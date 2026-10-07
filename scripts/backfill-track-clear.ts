import 'dotenv/config';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { raceEvents, races } from '@/db/schema';
import { fetchRaceControl } from '@/lib/ingest/openf1';

/**
 * Adds the "TRACK CLEAR" events the import used to drop, so the replay can end
 * a safety car, VSC or red flag instead of showing every car yellow until the
 * flag. Only races that had one, and only race control is fetched — not a
 * re-import. Safe to re-run: a race that already has its clears is skipped.
 *
 * Also retypes "VSC DEPLOYED", which was filed as a full safety car.
 *
 *   pnpm tsx scripts/backfill-track-clear.ts
 *   pnpm tsx --env-file=.env.prod scripts/backfill-track-clear.ts    production
 *
 * Then press "Refresh race pages" in the admin, or the pages keep the old
 * events until their cache runs out.
 */
async function main() {
  const db = getDb();

  const retyped = await db
    .update(raceEvents)
    .set({ type: 'VIRTUAL_SAFETY_CAR' })
    .where(and(eq(raceEvents.type, 'SAFETY_CAR'), sql`${raceEvents.details} ~* 'VSC|VIRTUAL'`))
    .returning({ id: raceEvents.id });
  console.log(`${retyped.length} VSC event(s) retyped`);

  const cautioned = await db
    .selectDistinct({ id: races.id, slug: races.slug, sessionKey: races.openf1SessionKey })
    .from(races)
    .innerJoin(raceEvents, eq(raceEvents.raceId, races.id))
    .where(
      and(
        isNotNull(races.openf1SessionKey),
        inArray(raceEvents.type, ['SAFETY_CAR', 'VIRTUAL_SAFETY_CAR', 'RED_FLAG']),
      ),
    );
  const done = new Set(
    (
      await db
        .selectDistinct({ raceId: raceEvents.raceId })
        .from(raceEvents)
        .where(and(eq(raceEvents.type, 'OTHER'), eq(raceEvents.details, 'TRACK CLEAR')))
    ).map((row) => row.raceId),
  );

  for (const race of cautioned) {
    if (done.has(race.id) || race.sessionKey == null) continue;
    // The same rule as transform.ts, so a re-import writes the same rows.
    const clears = (await fetchRaceControl(race.sessionKey)).filter(
      (message) => message.lap_number != null && message.flag === 'CLEAR' && message.scope === 'Track',
    );
    if (clears.length) {
      await db.insert(raceEvents).values(
        clears.map((message) => ({
          raceId: race.id,
          lap: message.lap_number!,
          type: 'OTHER' as const,
          details: message.message,
        })),
      );
    }
    console.log(`${race.slug}: ${clears.length} track clear(s)`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
