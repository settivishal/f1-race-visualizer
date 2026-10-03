import { getDb } from '@/db';
import { readHealth } from '@/lib/health';
import { clientKey, consume } from '@/lib/rate-limit';

/**
 * Is the ingest working?
 *
 * The whole observability design rested on a person noticing a stale row in
 * /admin/runs (docs/decisions.md, "Observability"), and nobody did: the cron
 * spent six months pointed at the wrong season, finding nothing, reporting
 * success. This endpoint is what a scheduled workflow can ask instead, and
 * `.github/workflows/health.yml` fails when the answer is no.
 *
 * Public and unauthenticated, deliberately. It exposes which season is
 * configured and which races are missing — operational facts about a site whose
 * whole content is public race data, and nothing about anyone. Requiring a
 * secret would mean the check could not run from anywhere, which is most of the
 * value of having it.
 *
 * No route config: handlers are not cached unless one opts in, and Cache
 * Components rejects `export const dynamic` outright. A cached health check
 * would be a health check of the cache.
 */

// Generous: this is one query and the caller is a workflow, but a public
// unauthenticated endpoint gets a bucket like every other one.
const HEALTH_BUCKET = { capacity: 30, refillPerSecond: 1 };

export async function GET(request: Request) {
  if (!(await consume(clientKey(request.headers, 'health'), HEALTH_BUCKET))) {
    return Response.json({ error: 'Too many requests' }, { status: 429 });
  }

  const report = await readHealth(getDb());

  // 503 rather than 200-with-a-flag: a monitor should not have to parse a body
  // to know something is wrong, and every uptime checker understands a status.
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
