import { revalidateTag } from 'next/cache';
import { isAuthorized } from '@/lib/cron-auth';

/**
 * Refreshes the race and standings pages after a write the site did not make
 * itself: scripts/import-predictions.ts runs on a laptop, outside Next, and
 * cannot touch its cache. Same secret as the cron.
 *
 * `{ expire: 0 }`, not the cron's 'max': this runs right after a deliberate
 * write, and with 'max' the first visit to each page — each tab, each prefetch
 * — still got the old one (Singapore 2026's Story and Analysis said "Results
 * pending" after the import). Now that visit waits for the new page instead.
 * `updateTag` does the same but is Server-Action-only; the admin's "Refresh
 * race pages" button uses it.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  revalidateTag('race', { expire: 0 });
  revalidateTag('standings', { expire: 0 });
  return Response.json({ revalidated: ['race', 'standings'] });
}
