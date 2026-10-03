import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { appConfig } from '@/db/schema';
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
  const [config] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1);

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

  const result = await drainPending(db, config);
  for (const sessionKey of result.abandoned) {
    console.log(`[cron/ingest] gave up on session ${sessionKey}: still no laps a week after it ended`);
  }
  if (result.imported.length === 0 && result.failed.length === 0) {
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
  if (result.imported.length > 0) {
    revalidateTag('race', 'max');
    revalidateTag('standings', 'max');
  }

  // A failure is still a failed cron, so Vercel reports it — but only after
  // the races that did import are live. Each failure is in ingest_runs.
  return Response.json(result, { status: result.failed.length > 0 ? 500 : 200 });
}

function skip(reason: string) {
  console.log(`[cron/ingest] skipped: ${reason}`);
  return Response.json({ skipped: reason });
}

/**
 * A shared secret, not a session — no user is involved in a cron invocation.
 *
 * Compared with `timingSafeEqual` rather than `===`. The difference is small
 * and the attack is impractical over a network, but a string compare that
 * returns early on the first wrong byte is the kind of thing worth not writing
 * in the first place, and it costs one function.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // A missing secret denies everything. It must never mean "no check needed" —
  // that is the same shape as the credential fallback the seed script exists to
  // avoid, and it would leave the endpoint open exactly where it is unset.
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : header;

  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a leak of one
  // bit — the length. Nothing can be done about that without padding, and the
  // length of a secret is not the secret.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
