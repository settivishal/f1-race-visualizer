'use server';

import { updateTag } from 'next/cache';
import { getDb } from '@/db';
import { readAppConfig } from '@/lib/app-config';
import { executeAsAdmin } from '@/graphql/execute';
import { drainPending } from '@/lib/ingest/pending';
import {
  SetRaceFeaturedDocument,
  TriggerIngestDocument,
  UpdateRaceMetadataDocument,
  type TriggerIngestMutation,
} from '@/graphql/generated/graphql';
import { messageOf, numberField, requireAdmin, type ActionResult } from './action-helpers';

export type { ActionResult };

/**
 * Every write the admin can perform. Each one calls `requireAdmin` as its first
 * statement; action-helpers.ts says why that is not decoration.
 */


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
    await executeAsAdmin(SetRaceFeaturedDocument, { slug, featured });
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
    await executeAsAdmin(UpdateRaceMetadataDocument, {
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

  const sessionKey = numberField(formData, 'sessionKey');
  if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
    return { ok: false, message: 'A numeric OpenF1 session key is required.' };
  }

  let result: TriggerIngestMutation;
  try {
    result = await executeAsAdmin(TriggerIngestDocument, { sessionKey });
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
  const config = await readAppConfig(db);
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
