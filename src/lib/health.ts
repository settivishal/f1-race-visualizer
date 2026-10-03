import { desc, eq } from 'drizzle-orm';
import type { getDb } from '@/db';
import { appConfig, ingestRuns, meetings, races } from '@/db/schema';
/**
 * Is the ingest actually working?
 *
 * This exists because of a failure that lasted six months in silence. The cron
 * was pointed at the wrong season, so every run found nothing to import and
 * answered "up to date" — correct code, correct schedule, zero races, and no
 * error anywhere. `ingest_runs` gained no rows, because a skip writes none.
 *
 * "The last run is old" is the obvious check and a poor one: between races
 * there is legitimately nothing to import for a fortnight, and over winter for
 * months. Quiet is normal. What is not normal is a race that has been run and
 * is still not in the database — and now that the whole calendar is stored, we
 * can ask that without calling upstream at all.
 */

export type HealthInput = {
  activeSeason: number;
  /** Every race of the active season, from the stored calendar. */
  races: { slug: string; date: Date; status: string }[];
  /** The newest ingest_runs row, if there is one. */
  lastRun: { status: string; startedAt: Date } | null;
  now: Date;
};

export type HealthReport = {
  ok: boolean;
  activeSeason: number;
  /** Races whose date has passed but which were never imported. */
  overdue: string[];
  problems: string[];
  lastRun: { status: string; startedAt: string } | null;
};

/**
 * How long after a race to stop calling it "just finished".
 *
 * The cron itself waits `hoursAfterRace` (12 by default) because upstream
 * publishes results progressively, then runs daily. Two days leaves room for
 * both plus a missed run, so a single hiccup does not page anyone.
 */
const GRACE_HOURS = 48;

export function checkHealth(input: HealthInput): HealthReport {
  const { activeSeason, races, lastRun, now } = input;
  const problems: string[] = [];

  const cutoff = new Date(now.getTime() - GRACE_HOURS * 60 * 60 * 1000);
  const overdue = races
    .filter((race) => race.status === 'SCHEDULED' && race.date < cutoff)
    .map((race) => race.slug);

  if (overdue.length > 0) {
    problems.push(
      `${overdue.length} race(s) ran more than ${GRACE_HOURS}h ago and are still not imported`,
    );
  }

  // The exact shape of the six-month failure: a season configured that the
  // database knows nothing about.
  if (races.length === 0) {
    problems.push(`the active season (${activeSeason}) has no races at all`);
  }

  // A failed run is not the same as a quiet one. The cron records both.
  if (lastRun?.status === 'FAILED') {
    problems.push('the most recent ingest run failed');
  }

  return {
    ok: problems.length === 0,
    activeSeason,
    overdue,
    problems,
    lastRun: lastRun
      ? { status: lastRun.status, startedAt: lastRun.startedAt.toISOString() }
      : null,
  };
}

/**
 * The report from the database — what `/api/health` serves and what the admin
 * page shows above its race list, so the two cannot disagree.
 */
export async function readHealth(db: ReturnType<typeof getDb>): Promise<HealthReport> {
  const [config] = await db
    .select({ activeSeason: appConfig.activeSeason })
    .from(appConfig)
    .where(eq(appConfig.id, 1))
    .limit(1);

  // No config row is the state of a fresh database, which the cron treats as
  // "not configured" and skips. Saying so is more useful than guessing a year.
  if (!config) {
    return {
      ok: false,
      activeSeason: 0,
      overdue: [],
      problems: ['no app_config row: the active season is not set'],
      lastRun: null,
    };
  }

  const [season, lastRun] = await Promise.all([
    db
      .select({ slug: races.slug, date: races.date, status: races.status })
      .from(races)
      .innerJoin(meetings, eq(meetings.id, races.meetingId))
      .where(eq(meetings.seasonYear, config.activeSeason)),
    db
      .select({ status: ingestRuns.status, startedAt: ingestRuns.startedAt })
      .from(ingestRuns)
      .orderBy(desc(ingestRuns.startedAt))
      .limit(1),
  ]);

  return checkHealth({
    activeSeason: config.activeSeason,
    races: season,
    lastRun: lastRun[0] ?? null,
    now: new Date(),
  });
}
