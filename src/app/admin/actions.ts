'use server';

import { updateTag } from 'next/cache';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb } from '@/db';
import { appConfig } from '@/db/schema';
import { executeAsAdmin } from '@/graphql/execute';
import { drainPending } from '@/lib/ingest/pending';
import type {
  SetRaceFeaturedMutation,
  TriggerIngestMutation,
  UpdateRaceMetadataMutation,
} from '@/graphql/generated/graphql';

/**
 * Every write the admin can perform.
 *
 * **Each function calls `requireAdmin` as its first statement, and that is not
 * decoration.** An exported Server Action is reachable by direct POST whether
 * or not anything imports it, and a page-level check does not extend to the
 * actions defined beneath it — Next's own data-security guide says so in those
 * words. The proxy guards navigation to `/admin`; it does not guard this.
 *
 * The failure mode is what makes it worth stating: an action missing its check
 * behaves correctly through the UI forever, because the UI only ever reaches it
 * from a page the proxy already guarded. Nothing surfaces the gap.
 *
 * See docs/decisions.md, "Three guard layers, not two".
 */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
}

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }
  | null;

/**
 * Each action takes the previous result as its first argument because that is
 * `useActionState`'s shape — the form needs the outcome back to report it, and
 * a plain `<form action>` can only return void. `ActionForm` is the client
 * wrapper that consumes it.
 */

/**
 * Cache invalidation lives here rather than in the resolvers.
 *
 * It needs a request context, so it can only run in a Server Function or a
 * Route Handler. A resolver reaching into Next's caching would also be the
 * wrong direction of dependency — and the same resolvers run from the cron
 * route and from `scripts/backfill.ts`, neither of which is a place this call
 * would work.
 *
 * `updateTag`, not `revalidateTag`. The two differ in who waits. `updateTag`
 * expires the entry outright, so the next request blocks until fresh data is
 * ready — read-your-own-writes, which is what an admin who just triggered an
 * import needs: seeing the old page after a successful import reads as a
 * failure. `revalidateTag` serves stale content while refreshing in the
 * background, which is the right trade for the cron in PR 3, where nobody is
 * waiting on the result. It is also Server-Action-only, which is why the cron
 * route cannot use it.
 *
 * Always last, and only after the write has succeeded. If it ran first and the
 * write then failed, the cache would be dropped and not replaced: the next
 * visitor takes a miss, re-renders from unchanged data, and the site has lost a
 * page that was working. A failure must leave things exactly as they were.
 */
function invalidateRaces() {
  updateTag('race');
  updateTag('standings');
}

export async function setFeaturedAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  const featured = formData.get('featured') === 'true';
  if (!slug) return { ok: false, message: 'No race given.' };

  try {
    await executeAsAdmin<SetRaceFeaturedMutation, { slug: string; featured: boolean }>(
      SET_FEATURED,
      { slug, featured },
    );
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  invalidateRaces();
  return {
    ok: true,
    message: featured ? `${slug} is now featured.` : `${slug} is no longer featured.`,
  };
}

export async function updateMetadataAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { ok: false, message: 'No race given.' };

  // Zero is allowed, and has to be: a race that was never run has no laps, and
  // the form posts the value it is showing. Rejecting 0 made every unrun race
  // uneditable — including the one correction this editor exists for, marking a
  // cancelled race CANCELLED.
  const rawLaps = String(formData.get('laps') ?? '').trim();
  const laps = rawLaps === '' ? null : Number(rawLaps);
  if (laps !== null && (!Number.isInteger(laps) || laps < 0)) {
    return { ok: false, message: 'Laps must be a whole number, zero or more.' };
  }

  try {
    await executeAsAdmin<UpdateRaceMetadataMutation, Record<string, unknown>>(UPDATE_METADATA, {
      slug,
      laps,
      name: String(formData.get('name') ?? '') || null,
      country: String(formData.get('country') ?? '') || null,
      // Not coalesced to null: an empty string is a meaningful instruction to
      // clear the circuit name, which is the one nullable field of the three.
      circuitName: String(formData.get('circuitName') ?? ''),
      status: String(formData.get('status') ?? '') || null,
      // Checkboxes the admin ticked to hand a field back to the ingest.
      release: formData.getAll('release').map(String),
    });
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }

  invalidateRaces();
  return { ok: true, message: `Updated ${slug}.` };
}

export async function triggerIngestAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const raw = String(formData.get('sessionKey') ?? '').trim();
  const sessionKey = Number(raw);
  if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
    return { ok: false, message: 'A numeric OpenF1 session key is required.' };
  }

  let result: TriggerIngestMutation;
  try {
    result = await executeAsAdmin<TriggerIngestMutation, { sessionKey: number }>(
      TRIGGER_INGEST,
      { sessionKey },
    );
  } catch (error) {
    // The failure is already recorded in ingest_runs by run.ts, so this only
    // has to surface it. The runs page is where the detail lives.
    return { ok: false, message: `Import failed: ${messageOf(error)}` };
  }

  invalidateRaces();

  const { slug, rowsWritten, warnings } = result.triggerIngest;
  const warningNote = warnings.length > 0 ? ` ${warnings.length} warning(s) — see runs.` : '';
  return { ok: true, message: `Imported ${slug}: ${rowsWritten} rows.${warningNote}` };
}

/**
 * "Refresh race pages": drops the cached race and standings pages, for a write
 * the admin did not make here. Chiefly scripts/import-predictions.ts, whose
 * own call to /api/revalidate serves the old page once more; this makes the
 * next visitor wait for the new one instead.
 */
export async function refreshRacesAction(): Promise<ActionResult> {
  await requireAdmin();
  invalidateRaces();
  return { ok: true, message: 'Race and standings pages rebuild on their next visit.' };
}

/**
 * "Import overdue races": the cron's own catch-up, on demand.
 *
 * The same `drainPending` the 06:00 run uses, so it imports exactly what the
 * cron would have — no session key to look up, and nothing it skips (cancelled
 * rounds, races with no laps a week on) that the cron would not also skip.
 * Bounded by the same time budget; a backlog bigger than one press clears on
 * the next press.
 */
export async function catchUpAction(): Promise<ActionResult> {
  await requireAdmin();

  const db = getDb();
  const [config] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1);
  if (!config) return { ok: false, message: 'No active season is set — see Settings.' };

  const { imported, failed, abandoned, remaining } = await drainPending(db, config);

  if (imported.length > 0) invalidateRaces();

  const parts = [
    imported.length > 0
      ? `Imported ${imported.map((race) => race.slug).join(', ')}.`
      : 'Nothing to import.',
    failed.length > 0 ? `${failed.length} failed — see runs.` : '',
    remaining > 0 ? `${remaining} still to go: press again.` : '',
    abandoned.length > 0
      ? `${abandoned.length} session(s) still have no laps a week on; mark them cancelled if they were.`
      : '',
  ];
  return { ok: failed.length === 0, message: parts.filter(Boolean).join(' ') };
}

/**
 * A resolver error reaches here as a GraphQLError whose message is safe to
 * show — they are written by this codebase, not by a driver. Anything else is
 * reported generically rather than leaking an internal string into the UI.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong.';
}

const SET_FEATURED = /* GraphQL */ `
  mutation SetRaceFeatured($slug: String!, $featured: Boolean!) {
    setRaceFeatured(slug: $slug, featured: $featured) {
      slug
      isFeatured
    }
  }
`;

const UPDATE_METADATA = /* GraphQL */ `
  mutation UpdateRaceMetadata(
    $slug: String!
    $laps: Int
    $name: String
    $country: String
    $circuitName: String
    $status: String
    $release: [String!]
  ) {
    updateRaceMetadata(
      slug: $slug
      laps: $laps
      name: $name
      country: $country
      circuitName: $circuitName
      status: $status
      release: $release
    ) {
      slug
      laps
      meeting {
        name
        country
        circuitName
      }
    }
  }
`;

const TRIGGER_INGEST = /* GraphQL */ `
  mutation TriggerIngest($sessionKey: Int!) {
    triggerIngest(sessionKey: $sessionKey) {
      slug
      rowsWritten
      warnings
    }
  }
`;

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * The cron's schedule, which is why it is editable at all.
 *
 * `vercel.json` fires the handler daily and cannot be changed without a deploy;
 * everything about *whether* it does anything lives in this row. So the cadence
 * moves without shipping code, and the static schedule never becomes the place
 * a decision hides.
 *
 * Written straight through Drizzle rather than a GraphQL mutation. The schema
 * exposes race data; a single settings row read and written by one page is not
 * a data-layer concern, and a mutation for it would be a public field guarding
 * something no client should ever ask about.
 */
export async function updateConfigAction(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();

  const activeSeason = Number(String(formData.get('activeSeason') ?? '').trim());
  if (!Number.isInteger(activeSeason) || activeSeason < 1950 || activeSeason > 2100) {
    return { ok: false, message: 'Active season must be a four-digit year.' };
  }

  const hoursAfterRace = Number(String(formData.get('hoursAfterRace') ?? '').trim());
  if (!Number.isInteger(hoursAfterRace) || hoursAfterRace < 0 || hoursAfterRace > 336) {
    return { ok: false, message: 'Hours after race must be between 0 and 336.' };
  }

  const predictionsShown = Number(String(formData.get('predictionsShown') ?? '').trim());
  const predictionsExpanded = Number(String(formData.get('predictionsExpanded') ?? '').trim());
  if (
    !Number.isInteger(predictionsShown) || !Number.isInteger(predictionsExpanded)
    || predictionsShown < 1 || predictionsExpanded < predictionsShown || predictionsExpanded > 30
  ) {
    return { ok: false, message: 'Predictions shown must be at least 1, and expanded between that and 30.' };
  }

  const runDays = WEEKDAYS.filter((day) => formData.get(`day-${day}`) === 'on');
  if (runDays.length === 0) {
    // Rejected rather than accepted silently: an empty list means the cron
    // skips every day, which looks identical to it having stopped working.
    return { ok: false, message: 'Pick at least one run day, or turn ingest off.' };
  }

  const ingestEnabled = formData.get('ingestEnabled') === 'on';
  const db = getDb();

  // The row is pinned to id 1 by a CHECK constraint, so this is an upsert on a
  // table that can only ever hold one row.
  await db
    .insert(appConfig)
    .values({
      id: 1, ingestEnabled, runDays: [...runDays], activeSeason, hoursAfterRace,
      predictionsShown, predictionsExpanded,
    })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: {
        ingestEnabled, runDays: [...runDays], activeSeason, hoursAfterRace,
        predictionsShown, predictionsExpanded,
      },
    });

  // The active season is now read by the home page and the standings default
  // (Query.activeSeason), so this does change what a page renders. `updateTag`
  // rather than `revalidateTag` for the reason above: an admin who just changed
  // the season should see it, not last season served stale while it refreshes.
  updateTag('settings');

  return { ok: true, message: 'Settings saved.' };
}

export async function getAppConfig() {
  await requireAdmin();
  const db = getDb();
  const [row] = await db.select().from(appConfig).where(eq(appConfig.id, 1)).limit(1);
  return row ?? null;
}
