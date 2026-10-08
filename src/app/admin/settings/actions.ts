'use server';

import { updateTag } from 'next/cache';
import { getDb } from '@/db';
import { appConfig } from '@/db/schema';
import { numberField, requireAdmin, type ActionResult } from '../action-helpers';

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

  const activeSeason = numberField(formData, 'activeSeason');
  if (!Number.isInteger(activeSeason) || activeSeason < 1950 || activeSeason > 2100) {
    return { ok: false, message: 'Active season must be a four-digit year.' };
  }

  const hoursAfterRace = numberField(formData, 'hoursAfterRace');
  if (!Number.isInteger(hoursAfterRace) || hoursAfterRace < 0 || hoursAfterRace > 336) {
    return { ok: false, message: 'Hours after race must be between 0 and 336.' };
  }

  const predictionsShown = numberField(formData, 'predictionsShown');
  const predictionsExpanded = numberField(formData, 'predictionsExpanded');
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
  // rather than `revalidateTag` (see ../actions.ts): an admin who just changed
  // the season should see it, not last season served stale while it refreshes.
  updateTag('settings');

  return { ok: true, message: 'Settings saved.' };
}
