import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { getRaceLibrary } from '@/lib/queries';

export const metadata = {
  title: 'Races — F1 Race Visualizer',
  description: 'Every grand prix and sprint in the archive, by season.',
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The race library.
 *
 * v1 did this as a client component that fetched every race on mount and
 * filtered in the browser. Here the filtering is `Query.races(season:,
 * search:)`, and the controls are a plain GET form — so the result set lives
 * in the URL rather than in component state. That makes a filtered view
 * shareable and reloadable, works before any JavaScript arrives, and lets the
 * cache hold the answer, which client-side filtering cannot.
 *
 * The page itself is deliberately not async. `searchParams` is runtime data,
 * and reading it in the page body would stop the whole route prerendering —
 * so the heading ships in the static shell and only the part that genuinely
 * depends on the query string streams in behind a Suspense boundary.
 */
export default function RacesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Archive"
        title="Races"
        description="Pick a race to replay it lap by lap."
      />
      <Suspense fallback={<div className="mt-8"><LoadingState label="Loading races" /></div>}>
        <RaceLibrary searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * Everything below the heading. `searchParams` is read here and the values are
 * passed to `getRaceLibrary` as arguments, because a `use cache` scope cannot
 * touch runtime APIs — and those same arguments are what key the cache entry.
 */
async function RaceLibrary({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const seasonParam = first(params.season);
  const parsedSeason = seasonParam ? Number(seasonParam) : NaN;
  const season = Number.isInteger(parsedSeason) ? parsedSeason : null;

  const search = first(params.q)?.trim() || null;
  const after = first(params.after) ?? null;

  const { races, seasons } = await getRaceLibrary(season, search, after);

  return (
    <>
      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Season
          <select
            name="season"
            defaultValue={season ?? ''}
            className="rounded-lg border border-line bg-panel-strong px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          >
            <option value="">All seasons</option>
            {seasons.map((entry) => (
              <option key={entry.year} value={entry.year}>
                {entry.year}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          Search
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Monaco, Silverstone, sprint…"
            className="w-full rounded-lg border border-line bg-panel-strong px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Filter
        </button>
      </form>

      {races.edges.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No races match"
            description="Try a different season, or clear the search."
          />
        </div>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {races.edges.map(({ node }) => (
            <li key={node.id}>
              <Link
                href={`/races/${node.slug}`}
                className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Card className="h-full transition-colors hover:border-accent">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    {node.meeting
                      ? `${node.meeting.season} · Round ${node.meeting.round}`
                      : 'Season unknown'}
                    {node.type === 'SPRINT' ? ' · Sprint' : ''}
                  </p>
                  <h2 className="mt-2 text-lg font-semibold">
                    {node.meeting?.name ?? node.slug}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    {node.meeting?.circuitName ?? node.meeting?.country ?? '—'} · {node.laps} laps
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {races.pageInfo.hasNextPage && races.pageInfo.endCursor ? (
        <div className="mt-8">
          <Link
            href={{
              pathname: '/races',
              query: {
                ...(season ? { season: String(season) } : {}),
                ...(search ? { q: search } : {}),
                after: races.pageInfo.endCursor,
              },
            }}
            className="inline-block rounded-lg border border-line px-4 py-2 text-sm font-semibold transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </>
  );
}
