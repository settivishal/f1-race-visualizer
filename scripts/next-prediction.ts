import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { and, asc, count, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { ergastRaceOn, fetchSeasonQualifying, type ErgastQualifyingRace } from '@/lib/ingest/ergast';

const { racePredictions, races } = schema;

/**
 * The race the predict workflow should predict now, if any: the next
 * scheduled grand prix, once its qualifying is published and while it has no
 * predictions. Prints the slug and writes `slug=<slug>` to $GITHUB_OUTPUT;
 * writes nothing when there is nothing to do.
 *
 *   pnpm tsx scripts/next-prediction.ts [--force]
 *
 * --force predicts a race that already has predictions.
 */
async function main() {
  const force = process.argv.includes('--force');
  const now = new Date();

  // Jolpica first. Until a qualifying is out there is nothing to predict, and
  // asking it does not wake Neon — most runs of the schedule stop here. A day
  // of slack because Ergast can file a race under the day before (ergastRaceOn).
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const qualifyingByDate = new Map<string, ErgastQualifyingRace>();
  for (const race of await fetchSeasonQualifying(now.getUTCFullYear())) {
    if (race.date >= yesterday && race.QualifyingResults.length > 0) qualifyingByDate.set(race.date, race);
  }
  if (qualifyingByDate.size === 0) return done('no upcoming race has published qualifying yet');

  const db = getDb();
  const [race] = await db
    .select({ id: races.id, slug: races.slug, date: races.date })
    .from(races)
    .where(and(eq(races.type, 'GRAND_PRIX'), eq(races.status, 'SCHEDULED'), gt(races.date, now)))
    .orderBy(asc(races.date))
    .limit(1);
  if (!race) return done('no scheduled grand prix ahead');
  if (!ergastRaceOn(race.date, qualifyingByDate)) return done(`${race.slug}: qualifying not published yet`);

  const [{ n }] = await db
    .select({ n: count() })
    .from(racePredictions)
    .where(eq(racePredictions.raceId, race.id));
  if (n > 0 && !force) return done(`${race.slug}: already predicted (--force to redo)`);

  console.log(race.slug);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `slug=${race.slug}\n`);
  process.exit(0);
}

function done(reason: string) {
  console.log(`nothing to predict: ${reason}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
