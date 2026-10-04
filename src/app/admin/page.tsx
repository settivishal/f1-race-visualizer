import { Suspense } from 'react';
import Link from 'next/link';
import { AutoSubmit } from '@/components/ui/auto-submit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { executeAsAdmin } from '@/graphql/execute';
import type { AdminRacesQuery } from '@/graphql/generated/graphql';
import { ActionForm } from '@/components/admin/action-form';
import { getDb } from '@/db';
import { readHealth } from '@/lib/health';
import { catchUpAction, refreshRacesAction, setFeaturedAction, triggerIngestAction } from './actions';

export const metadata = {
  title: 'Races — Admin',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The admin race list.
 *
 * Deliberately thinner than v1, which rebuilt CRUD over every driver, team and
 * position row. The cron does the bulk work; what an admin actually needs is to
 * re-run an import, pick the featured race, and fix a name an import got wrong.
 *
 * Not async, for the same reason `/races` is not: `searchParams` is runtime
 * data and reading it in the page body would stop the shell prerendering.
 */
export default function AdminRacesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        title="Races"
        description="Re-run an import, choose the featured race, or correct an imported name."
      />
      <Suspense fallback={<Skeleton className="mt-8 h-24 w-full" />}>
        <IngestStatus />
      </Suspense>
      <Suspense fallback={<ListSkeleton />}>
        <RaceList searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * Whether the import is keeping up — the same report `/api/health` serves, so
 * the admin sees what the daily health email would say without waiting for it.
 * The button is the manual catch-up for when it is not.
 */
async function IngestStatus() {
  const report = await readHealth(getDb());
  const lastRun = report.lastRun
    ? `Last import ${new Date(report.lastRun.startedAt).toUTCString()} (${report.lastRun.status.toLowerCase()}).`
    : 'No import has run yet.';

  return (
    <Card className="mt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="type-card-title">Import status</h2>
            {report.ok ? <Badge>Up to date</Badge> : <Badge tone="accent">Behind</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{lastRun}</p>
          {report.overdue.length > 0 ? (
            <p className="mt-1 text-sm text-muted">Overdue: {report.overdue.join(', ')}</p>
          ) : null}
          {report.problems
            .filter((problem) => !problem.includes('still not imported'))
            .map((problem) => (
              <p key={problem} className="mt-1 text-sm text-muted">{problem}</p>
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={refreshRacesAction} className="max-w-60">
            <Button type="submit" variant="secondary">Refresh race pages</Button>
          </ActionForm>
          <ActionForm action={catchUpAction} className="max-w-60">
            <Button type="submit" variant={report.ok ? 'secondary' : 'primary'}>
              Import overdue races
            </Button>
          </ActionForm>
        </div>
      </div>
    </Card>
  );
}

async function RaceList({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const seasonParam = first(params.season);
  const parsedSeason = seasonParam ? Number(seasonParam) : NaN;
  const season = Number.isInteger(parsedSeason) ? parsedSeason : null;
  const search = first(params.q)?.trim() || null;
  const after = first(params.after) ?? null;

  // executeAsAdmin, not executeQuery: this reads no admin-only field today, but
  // it must never be cached — the featured flag has to reflect the toggle that
  // was just pressed, and a `use cache` scope could not read the session anyway.
  const { races, seasons } = await executeAsAdmin<AdminRacesQuery, Record<string, unknown>>(
    ADMIN_RACES,
    { season, search, first: 24, after },
  );

  const fieldClasses =
    'h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-foreground transition-[border-color] hover:border-line-strong';

  return (
    <>
      <Card className="mt-8">
        <h2 className="type-card-title">Import a session</h2>
        <p className="mt-1 text-sm text-muted">
          Runs the same code path as the backfill script and the cron job — same transaction,
          same idempotency. Re-importing a race that already exists changes no row counts.
        </p>
        <ActionForm action={triggerIngestAction} className="mt-4">
          <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-eyebrow font-semibold uppercase text-muted">
              OpenF1 session key
            </span>
            <input
              name="sessionKey"
              inputMode="numeric"
              placeholder="9693"
              required
              className={`${fieldClasses} tabular w-40`}
            />
          </label>
            <Button type="submit" variant="secondary">
              Import
            </Button>
          </div>
        </ActionForm>
      </Card>

      <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        {/* The season applies on pick; the search box still needs the button. */}
        <AutoSubmit />
        <label className="flex flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase text-muted">Season</span>
          <select name="season" defaultValue={season ?? ''} className={fieldClasses}>
            <option value="">All seasons</option>
            {seasons.map((entry) => (
              <option key={entry.year} value={entry.year}>
                {entry.year}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase text-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Monaco, sprint…"
            className={fieldClasses}
          />
        </label>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {races.edges.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No races match" description="Try a different season or search." />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {races.edges.map(({ node }) => (
            <li key={node.id}>
              <Card className="flex flex-wrap items-center gap-4">
                <div className="min-w-56 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-eyebrow font-semibold uppercase text-muted">
                      {node.meeting
                        ? `${node.meeting.season} · R${node.meeting.round}`
                        : 'Season unknown'}
                    </span>
                    {node.type === 'SPRINT' ? <Badge>Sprint</Badge> : null}
                    {node.isFeatured ? <Badge tone="accent">Featured</Badge> : null}
                  </div>
                  <p className="type-card-title mt-1.5">
                    {node.meeting?.name ?? node.slug}
                  </p>
                  <p className="tabular mt-0.5 text-sm text-muted">
                    {node.slug} · {node.laps} laps
                    {node.openf1SessionKey ? ` · session ${node.openf1SessionKey}` : ' · no session key'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <ActionForm action={setFeaturedAction} showResult={false}>
                    <input type="hidden" name="slug" value={node.slug} />
                    <input
                      type="hidden"
                      name="featured"
                      value={node.isFeatured ? 'false' : 'true'}
                    />
                    <Button type="submit" variant={node.isFeatured ? 'ghost' : 'secondary'} size="sm">
                      {node.isFeatured ? 'Unfeature' : 'Feature'}
                    </Button>
                  </ActionForm>

                  {node.openf1SessionKey ? (
                    <ActionForm action={triggerIngestAction} showResult={false}>
                      <input
                        type="hidden"
                        name="sessionKey"
                        value={String(node.openf1SessionKey)}
                      />
                      <Button type="submit" variant="secondary" size="sm">
                        Re-import
                      </Button>
                    </ActionForm>
                  ) : null}

                  <Link href={`/admin/races/${node.slug}`}>
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </Link>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {races.pageInfo.hasNextPage && races.pageInfo.endCursor ? (
        <div className="mt-8 flex justify-center">
          <Link
            href={{
              pathname: '/admin',
              query: {
                ...(season ? { season: String(season) } : {}),
                ...(search ? { q: search } : {}),
                after: races.pageInfo.endCursor,
              },
            }}
          >
            <Button variant="secondary">Next page</Button>
          </Link>
        </div>
      ) : null}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-8 space-y-3">
      <Skeleton className="h-40 w-full rounded-xl" />
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-xl" />
      ))}
    </div>
  );
}

const ADMIN_RACES = /* GraphQL */ `
  query AdminRaces($season: Int, $search: String, $first: Int, $after: String) {
    races(season: $season, search: $search, first: $first, after: $after) {
      edges {
        cursor
        node {
          id slug laps type isFeatured openf1SessionKey
          meeting { name country circuitName round season }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    seasons { year }
  }
`;
