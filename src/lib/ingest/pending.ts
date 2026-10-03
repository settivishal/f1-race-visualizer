import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { getDb } from '@/db';
import { ingestRuns, races } from '@/db/schema';
import { fetchSessions, type Session } from './openf1';
import { ingestRace } from './run';
import { isScoredSession } from './transform';

/**
 * Which sessions of a season still need importing — shared by the cron and the
 * admin's "Import overdue races" button, so the two cannot disagree about what
 * is behind.
 *
 * Logic is `docs/system-design.md`, "Ingest scheduling".
 */

/**
 * How long a session keeps being retried after its first import attempt.
 *
 * OpenF1 publishes progressively, so a session with nothing yet is usually just
 * early — but a round called off after the calendar was published stays listed
 * forever and never gets a lap. Without a limit it is picked first on every run
 * and nothing behind it is reached, which is exactly how Sakhir 2026 stalled the
 * import. A week is far past any real publishing delay.
 *
 * Counted from the first attempt *after the session ended*, not from the race
 * date: every race has a calendar row long before it runs, so a race missed
 * during an outage looks exactly like an empty one by its date alone. And not
 * from any attempt: the calendar import tries every session of the season up
 * front, so Madring had "no lap data" runs a week before it was held.
 */
const GIVE_UP_AFTER_DAYS = 7;

export type StoredRace = {
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  hasPositions: boolean;
  /** When ingest_runs tried this session (epoch ms), oldest first. */
  attempts: number[];
};

/**
 * The pure half: given what upstream lists and what the database holds, the
 * sessions to import, oldest first.
 *
 * "Still to import" is a session with no race row, or a race row with no
 * positions — the second is an import that failed partway or wrote nothing, and
 * leaving it out would make one bad import a permanent hole.
 *
 * Skipped:
 * - Not yet settled (`hoursAfterRace`): importing as a race ends produces a
 *   partial replay that looks like a successful run.
 * - Cancelled. An admin said it did not happen; there is nothing to wait for.
 * - First tried after it ended more than `GIVE_UP_AFTER_DAYS` ago, still empty. Named in
 *   `abandoned` so the cron can log it — the admin's cue to mark it cancelled.
 */
export function selectPending(
  sessions: Session[],
  stored: Map<number, StoredRace>,
  { now, hoursAfterRace }: { now: number; hoursAfterRace: number },
): { pending: number[]; abandoned: number[] } {
  const settledBy = now - hoursAfterRace * 60 * 60 * 1000;
  const giveUpBy = now - GIVE_UP_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const pending: number[] = [];
  const abandoned: number[] = [];

  const ordered = sessions
    .filter(isScoredSession)
    .sort((left, right) => left.date_start.localeCompare(right.date_start));

  for (const session of ordered) {
    const ended = Date.parse(session.date_end);
    if (ended > settledBy) continue;

    const race = stored.get(session.session_key);
    if (race?.status === 'CANCELLED' || race?.hasPositions) continue;

    const firstTriedAfter = race?.attempts.find((at) => at >= ended);
    if (firstTriedAfter !== undefined && firstTriedAfter < giveUpBy) {
      abandoned.push(session.session_key);
      continue;
    }

    pending.push(session.session_key);
  }

  return { pending, abandoned };
}

/** The impure half: fetch upstream's list and the stored state, then select. */
export async function pendingSessions(
  db: ReturnType<typeof getDb>,
  { season, hoursAfterRace }: { season: number; hoursAfterRace: number },
) {
  const sessions = await fetchSessions(season);
  const keys = sessions.map((session) => session.session_key);
  if (keys.length === 0) return { pending: [], abandoned: [] };

  // One query rather than one per race: whether any position row exists.
  // `races.id` is spelled out rather than interpolated: inside a select list
  // Drizzle renders `${races.id}` as a bare "id", which the subquery resolves
  // to `p.id` — every race then reads as empty.
  const rows = await db
    .select({
      sessionKey: races.openf1SessionKey,
      status: races.status,
      hasPositions: sql<boolean>`exists (select 1 from race_positions p where p.race_id = "races"."id")`,
    })
    .from(races)
    .where(inArray(races.openf1SessionKey, keys));

  const runs = await db
    .select({ target: ingestRuns.target, startedAt: ingestRuns.startedAt })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.source, 'openf1'), inArray(ingestRuns.target, keys.map(String))))
    .orderBy(asc(ingestRuns.startedAt));
  const attempts = new Map<number, number[]>();
  for (const run of runs) {
    const key = Number(run.target);
    attempts.set(key, [...(attempts.get(key) ?? []), run.startedAt.getTime()]);
  }

  const stored = new Map<number, StoredRace>();
  for (const row of rows) {
    if (row.sessionKey !== null) {
      stored.set(row.sessionKey, {
        status: row.status,
        hasPositions: row.hasPositions,
        attempts: attempts.get(row.sessionKey) ?? [],
      });
    }
  }

  return selectPending(sessions, stored, { now: Date.now(), hoursAfterRace });
}

/**
 * Stop starting new races after this long. One race takes 5-20s, so the last
 * one finishes inside the route's 60s `maxDuration`; a backlog bigger than one
 * run can hold carries on at the next.
 */
const BUDGET_MS = 45_000;

/**
 * Import every pending session, oldest first, until the budget is spent.
 *
 * One failure does not end the run: it is recorded in ingest_runs by
 * `ingestRace` and the next race is tried, so a single broken session cannot
 * hold the rest of the season behind it.
 */
export async function drainPending(
  db: ReturnType<typeof getDb>,
  config: { activeSeason: number; hoursAfterRace: number },
) {
  const started = Date.now();
  const { pending, abandoned } = await pendingSessions(db, {
    season: config.activeSeason,
    hoursAfterRace: config.hoursAfterRace,
  });

  const imported: { slug: string; rowsWritten: number; warnings: string[] }[] = [];
  const failed: { sessionKey: number; error: string }[] = [];

  for (const sessionKey of pending) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const { slug, rowsWritten, warnings } = await ingestRace(sessionKey);
      imported.push({ slug, rowsWritten, warnings });
    } catch (error) {
      failed.push({ sessionKey, error: String(error) });
    }
  }

  return {
    imported,
    failed,
    abandoned,
    remaining: pending.length - imported.length - failed.length,
  };
}
