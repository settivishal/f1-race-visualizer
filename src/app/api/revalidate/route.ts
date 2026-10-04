import { revalidateTag } from 'next/cache';
import { isAuthorized } from '@/lib/cron-auth';

/**
 * Refreshes the race and standings pages after a write the site did not make
 * itself: scripts/import-predictions.ts runs on a laptop, outside Next, and
 * cannot touch its cache. Same secret as the cron.
 *
 * `revalidateTag` with 'max', as the cron does: the next visitor gets the last
 * page while the new one builds. `updateTag` would make them wait for it, but
 * that is Server-Action-only; the admin's "Refresh race pages" button uses it.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  revalidateTag('race', 'max');
  revalidateTag('standings', 'max');
  return Response.json({ revalidated: ['race', 'standings'] });
}
