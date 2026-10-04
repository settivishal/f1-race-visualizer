import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { parseCsv, PredictionRowSchema, predictionProblems } from '@/lib/predictions';

const { drivers, racePredictions, races } = schema;

/**
 * Loads the model's win probabilities into race_predictions.
 *
 *   pnpm tsx scripts/import-predictions.ts [ml/out/predictions.csv]
 *
 * Writes nothing unless the whole file is good: every race's probabilities sum
 * to 1, every driver is in that race's rows in ml/data/features.csv (the field
 * the model was given), and every race is a grand prix we have. It is written in one
 * statement, then the race pages are refreshed through
 * /api/revalidate, which needs SITE_URL and CRON_SECRET. Without them the
 * import still stands; press "Refresh race pages" in /admin instead.
 *
 * Dev by default (.env). Production: --env-file=.env.prod.
 */
async function main() {
  const path = process.argv[2] ?? 'ml/out/predictions.csv';

  const rows = parseCsv(readFileSync(path, 'utf8')).map((record, index) => {
    const parsed = PredictionRowSchema.safeParse(record);
    if (!parsed.success) throw new Error(`${path} row ${index + 2}: ${parsed.error.issues[0].message}`);
    return parsed.data;
  });

  const entryList = new Map<string, Set<string>>();
  for (const feature of parseCsv(readFileSync('ml/data/features.csv', 'utf8'))) {
    const entrants = entryList.get(feature.race_slug) ?? new Set<string>();
    entrants.add(feature.driver_code);
    entryList.set(feature.race_slug, entrants);
  }

  const problems = predictionProblems(rows, entryList);

  const db = getDb();
  const slugs = [...new Set(rows.map((row) => row.race_slug))];
  const codes = [...new Set(rows.map((row) => row.driver_code))];
  const raceRows = await db
    .select({ id: races.id, slug: races.slug, type: races.type })
    .from(races)
    .where(inArray(races.slug, slugs));
  const driverRows = await db
    .select({ id: drivers.id, code: drivers.code })
    .from(drivers)
    .where(inArray(drivers.code, codes));
  const raceIdBySlug = new Map(raceRows.map((race) => [race.slug, race]));
  const driverIdByCode = new Map(driverRows.map((driver) => [driver.code, driver.id]));

  for (const slug of slugs) {
    const race = raceIdBySlug.get(slug);
    if (!race) problems.push(`${slug}: no such race`);
    else if (race.type !== 'GRAND_PRIX') problems.push(`${slug}: is a ${race.type}, not a grand prix`);
  }
  for (const code of codes) {
    if (!driverIdByCode.has(code)) problems.push(`${code}: no such driver`);
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    throw new Error(`${problems.length} problem(s); nothing written.`);
  }

  // One statement, so all of it or none of it.
  await db
    .insert(racePredictions)
    .values(rows.map((row) => ({
      raceId: raceIdBySlug.get(row.race_slug)!.id,
      driverId: driverIdByCode.get(row.driver_code)!,
      winProbability: row.win_probability,
      modelVersion: row.model_version,
    })))
    .onConflictDoUpdate({
      target: [racePredictions.raceId, racePredictions.driverId, racePredictions.modelVersion],
      set: { winProbability: sql`excluded.win_probability`, generatedAt: sql`now()` },
    });
  console.log(`${rows.length} predictions for ${slugs.length} race(s) written.`);

  await revalidate();
  process.exit(0);
}

async function revalidate() {
  const { SITE_URL: site, CRON_SECRET: secret } = process.env;
  if (!site || !secret) {
    console.log('SITE_URL or CRON_SECRET unset: press "Refresh race pages" in /admin.');
    return;
  }
  const response = await fetch(`${site}/api/revalidate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }).catch((error: Error) => ({ ok: false, status: error.message }) as const);
  console.log(response.ok
    ? `Race pages refreshed on ${site}.`
    : `Refresh failed (${response.status}): press "Refresh race pages" in /admin.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
