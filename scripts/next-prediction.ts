import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { and, asc, count, eq, gt } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { fetchQualifying } from '@/lib/ingest/openf1';

const { meetings, racePredictions, races } = schema;

/**
 * The race the predict workflow should predict now, if any: the next
 * scheduled grand prix, once OpenF1 has its qualifying and while it has no
 * predictions. Every run reads Neon once, for the race and its meeting key. Prints the slug and writes `slug=<slug>` to $GITHUB_OUTPUT;
 * writes nothing when there is nothing to do.
 *
 *   pnpm tsx scripts/next-prediction.ts [--force]
 *
 * --force predicts a race that already has predictions.
 */
async function main() {
  const force = process.argv.includes('--force');
  const now = new Date();

  const db = getDb();
  const [race] = await db
    .select({ id: races.id, slug: races.slug, season: meetings.seasonYear, meetingKey: meetings.openf1MeetingKey })
    .from(races)
    .innerJoin(meetings, eq(meetings.id, races.meetingId))
    .where(and(eq(races.type, 'GRAND_PRIX'), eq(races.status, 'SCHEDULED'), gt(races.date, now)))
    .orderBy(asc(races.date))
    .limit(1);
  if (!race) return done('no scheduled grand prix ahead');
  if (race.meetingKey === null) return done(`${race.slug}: meeting has no OpenF1 key`);
  // OpenF1's free tier answers 401 from 30 minutes before a session to 30
  // after it. A scheduled run that lands there has nothing wrong to report.
  const qualifying = await fetchQualifying(race.meetingKey, race.season).catch((error) => {
    if ((error as { status?: number }).status === 401) return null;
    throw error;
  });
  if (qualifying === null) return done(`${race.slug}: OpenF1 is in a live session (401), a later run will check`);
  if (qualifying.length === 0) return done(`${race.slug}: qualifying not published yet`);

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
