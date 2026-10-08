import 'dotenv/config';
import { and, eq, exists, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fetchSeasonResults } from '@/lib/ingest/ergast';
import { ingestArchiveRace } from '@/lib/ingest/run';

/**
 * Imports an archive season from Ergast — 2018 through 2022, the years OpenF1
 * does not serve.
 *
 *   pnpm tsx scripts/backfill-archive.ts 2019             the whole season
 *   pnpm tsx scripts/backfill-archive.ts 2019 --round=4  one round of it
 *   pnpm tsx scripts/backfill-archive.ts 2019 --force    redo rounds already stored
 *
 * Resumable by default, and that is the point. Jolpica's sustained limit is 500
 * requests an hour and a season costs roughly 280, so a run that is cut off —
 * a six-hour workflow limit, a network drop, a rate limit that tightened
 * without notice — must be restartable without spending the budget again on
 * races that already landed. A race is "already landed" when its row exists
 * with position rows behind it; the same check the cron uses to recover a
 * half-finished import.
 *
 * The season's results are fetched once and passed into each race, because they
 * arrive as one paginated set for the whole season. Fetching them per race
 * would multiply the run's cost by twenty for identical bytes.
 */
async function main() {
  const season = Number(process.argv[2]);
  const force = process.argv.includes('--force');
  // One round at a time, for retrying the race a season run failed on without
  // paying for the twenty that succeeded.
  const only = process.argv
    .filter((arg) => arg.startsWith('--round='))
    .map((arg) => Number(arg.slice('--round='.length)));

  if (!Number.isFinite(season) || season < 1996 || season > 2100) {
    console.error('usage: tsx scripts/backfill-archive.ts <season> [--force]');
    console.error('       seasons before 1996 have no lap data to replay');
    process.exit(1);
  }

  console.log(`fetching the ${season} season from Ergast…`);
  const races = await fetchSeasonResults(season);
  const wanted = only.length > 0 ? races.filter((r) => only.includes(r.round)) : races;
  console.log(`${races.length} race(s) published, ${wanted.length} to import\n`);

  const done = force ? new Set<number>() : await roundsAlreadyStored(season);
  if (done.size > 0) {
    console.log(`skipping ${done.size} round(s) already imported — pass --force to redo them\n`);
  }

  let failed = 0;
  let skipped = 0;

  for (const [index, race] of wanted.entries()) {
    const label = `[${index + 1}/${wanted.length}] ${season} round ${race.round}`;

    if (done.has(race.round)) {
      skipped++;
      continue;
    }

    try {
      const result = await ingestArchiveRace(season, race.round, races);
      console.log(`${label} ${result.slug} — ${result.rowsWritten} rows`);
      for (const warning of result.warnings) console.log(`    warning: ${warning}`);
    } catch (error) {
      // One race failing must not end the season, exactly as in the OpenF1
      // backfill. Every attempt is in ingest_runs either way.
      failed++;
      console.error(`${label} FAILED — ${error}`);
    }
  }

  console.log(
    `\ndone: ${wanted.length - failed - skipped} imported, ${skipped} skipped, ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

/**
 * Rounds that already have a race row *with position rows behind it*.
 *
 * The row alone is not enough: an import that failed after writing the race but
 * before its laps would otherwise be skipped forever, which is the exact shape
 * of a silently incomplete season.
 */
async function roundsAlreadyStored(season: number): Promise<Set<number>> {
  const db = getDb();

  const rows = await db
    .select({ round: schema.meetings.round })
    .from(schema.races)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.races.meetingId))
    .where(and(
      eq(schema.meetings.seasonYear, season),
      exists(db.select({ one: sql`1` }).from(schema.racePositions)
        .where(eq(schema.racePositions.raceId, schema.races.id))),
    ));

  return new Set(rows.map((row) => row.round));
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
