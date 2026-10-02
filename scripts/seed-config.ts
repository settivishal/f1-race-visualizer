import 'dotenv/config';
import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';

/**
 * Creates the single `app_config` row, if there is not one.
 *
 *   pnpm tsx scripts/seed-config.ts             # infer the season
 *   ACTIVE_SEASON=2026 pnpm tsx scripts/seed-config.ts
 *
 * Without this row the ingest cron does nothing at all — it reads the row to
 * find the active season, and skips with "not configured" when there is none.
 * That is a silent no-op: a 200, a log line nobody reads, and no `ingest_runs`
 * entry, because a skip writes none. `/api/health` reports it now, which is how
 * the dev database turned out to have been in that state the whole time.
 *
 * Idempotent, and deliberately not an upsert: an existing row is somebody's
 * configuration, and the admin page is where it gets changed. This is for
 * bootstrapping a database that has none — a fresh Neon branch, a restored
 * backup, a new preview environment.
 */
async function main() {
  const db = getDb();

  const [existing] = await db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.id, 1))
    .limit(1);

  if (existing) {
    console.log('app_config already exists:', {
      activeSeason: existing.activeSeason,
      ingestEnabled: existing.ingestEnabled,
      runDays: existing.runDays,
      hoursAfterRace: existing.hoursAfterRace,
    });
    console.log('\nnothing to do — change it in /admin/settings');
    return;
  }

  const requested = process.env.ACTIVE_SEASON;
  let activeSeason = requested ? Number(requested) : NaN;

  if (requested && !Number.isInteger(activeSeason)) {
    console.error(`ACTIVE_SEASON must be a year; got "${requested}"`);
    process.exit(1);
  }

  if (!requested) {
    // The newest season that actually has a race, for the same reason
    // Query.activeSeason falls back that way: in January the calendar year is a
    // season nothing has happened in.
    const [newest] = await db
      .select({ year: schema.meetings.seasonYear })
      .from(schema.meetings)
      .innerJoin(schema.races, eq(schema.races.meetingId, schema.meetings.id))
      .orderBy(desc(schema.meetings.seasonYear))
      .limit(1);

    if (!newest) {
      console.error(
        'No races imported, so there is no season to infer. Import one first, or pass ACTIVE_SEASON.',
      );
      process.exit(1);
    }
    activeSeason = newest.year;
  }

  await db.insert(schema.appConfig).values({
    id: 1,
    ingestEnabled: true,
    // Every day: a run with nothing to import costs one OpenF1 call, and a
    // weekly run turned a three-week outage into months of catching up.
    runDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    activeSeason,
    hoursAfterRace: 12,
  });

  console.log(`created app_config with active season ${activeSeason}`);
  console.log('the cron runs on Mondays, 12 hours after a race — change that in /admin/settings');
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
