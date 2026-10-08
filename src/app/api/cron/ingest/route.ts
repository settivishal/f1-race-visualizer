import { revalidateTag } from 'next/cache';
import { getDb } from '@/db';
import { readAppConfig } from '@/lib/app-config';
import { isAuthorized } from '@/lib/cron-auth';
import { fillGrids } from '@/lib/ingest/grid';
import { drainPending } from '@/lib/ingest/pending';

/**
 * The scheduled import.
 *
 * The schedule in vercel.json is deliberately dumb — daily, and Vercel's Hobby
 * plan allows no more than that anyway — and the cadence lives in `app_config`,
 * which the admin can edit. So changing when this runs needs no deploy, and the
 * static schedule never becomes the place a decision hides.
 *
 * As many races per invocation as fit in a time budget. It used to be one,
 * which with a weekly run day meant a three-week outage took months to clear —
 * and a cancelled round with no laps was "the next race" forever. See
 * `lib/ingest/pending.ts` for what counts as still to import.
 *
 * Logic is `docs/system-design.md`, "Ingest scheduling".
 *
 * **Both verbs, and that is not laziness.** The design doc says
 * `POST /api/cron/ingest`, but Vercel's scheduler invokes a cron path with a
 * GET — a POST-only handler would return 405 to the only caller that matters,
 * every morning, and the symptom would be "the cron does nothing" rather than
 * anything that looks like a routing mistake. GET is what Vercel calls; POST is
 * what a person calls with curl, and what the verification step uses.
 *
 * Vercel adds `Authorization: Bearer $CRON_SECRET` to its own request when that
 * variable is set, which is exactly what `isAuthorized` expects, so the
 * scheduled call and the manual one authenticate identically.
 */
// The drain loop stops starting new races at 45s (see drainPending); this is
// the ceiling the last one finishes under.
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const config = await readAppConfig(db);

  // A skip is a 200 with a reason, not an error: nothing is wrong, and a 500
  // would make Vercel report a healthy cron as failing. The reason lands in the
  // function log, which is where "why did nothing import" gets answered.
  if (!config) {
    return skip('not configured — no app_config row; set the active season in /admin/settings');
  }
  if (!config.ingestEnabled) {
    return skip('disabled');
  }
  if (!config.runDays.includes(weekdayUtc())) {
    return skip(`not a run day (${weekdayUtc()}; runs on ${config.runDays.join(', ')})`);
  }

  const started = Date.now();
  const result = await drainPending(db, config);
  for (const sessionKey of result.abandoned) {
    console.log(`[cron/ingest] gave up on session ${sessionKey}: still no laps a week after it ended`);
  }

  // Grids for the last fortnight's races, on every run rather than only after
  // an import: Ergast can lag the import, and it is the next day's run, which
  // imports nothing, that finds the grid. Best-effort and only with time left
  // under maxDuration — a missing grid is a blank cell, never a failed cron.
  const grid = Date.now() - started < 40_000
    ? await fillGrids(db, config.activeSeason, { since: new Date(Date.now() - GRID_WINDOW_MS) })
      .catch((error) => {
        console.log(`[cron/ingest] grid fill failed: ${error}`);
        return null;
      })
    : null;
  for (const warning of grid?.warnings ?? []) console.log(`[cron/ingest] grid: ${warning}`);

  if (result.imported.length === 0 && result.failed.length === 0 && !grid?.filled) {
    return skip('up to date');
  }

  // Last, and only if something landed. If this ran before the imports and
  // they then failed, the cache would be dropped and not replaced: the next
  // visitor takes a miss, re-renders from unchanged data, and the site has lost
  // a page that was working.
  //
  // `revalidateTag`, not `updateTag`. updateTag is Server-Action-only, and its
  // semantics are wrong here anyway: it expires the entry so the next request
  // blocks, and nobody is waiting on a 6am cron. 'max' serves the last good
  // page while the new one builds in the background.
  if (result.imported.length > 0 || grid?.filled) {
    revalidateTag('race', 'max');
    revalidateTag('standings', 'max');
  }

  // A failure is still a failed cron, so Vercel reports it — but only after
  // the races that did import are live. Each failure is in ingest_runs.
  return Response.json({ ...result, gridsFilled: grid?.filled ?? 0 }, { status: result.failed.length > 0 ? 500 : 200 });
}

/** How far back the cron looks for a race Ergast had not caught up on. */
const GRID_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function skip(reason: string) {
  console.log(`[cron/ingest] skipped: ${reason}`);
  return Response.json({ skipped: reason });
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * UTC, because Vercel interprets cron schedules in UTC and the run days should
 * mean the same thing as the schedule. A local-time weekday would disagree with
 * the schedule for part of the year, which is the sort of bug that appears once
 * and then hides for six months.
 */
function weekdayUtc(now = new Date()): string {
  return WEEKDAYS[now.getUTCDay()];
}
