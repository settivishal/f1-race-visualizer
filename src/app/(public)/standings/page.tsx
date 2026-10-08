import { Suspense } from 'react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SeasonFilter } from '@/components/ui/season-filter';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getActiveSeason, getSeasonStandings } from '@/lib/queries';
import { yearParam, type SearchParams } from '@/lib/search-params';

export const metadata = {
  title: 'Standings',
  description: 'Drivers and constructors championships, derived from race results.',
};

/**
 * The championship tables.
 *
 * Neither table is stored — both are aggregates over `race_results` computed in
 * `driverStandings` / `constructorStandings`, so a post-race penalty changes the
 * order here the moment the result row changes, with nothing to re-derive.
 *
 * Same shape as the race library: the page is not async, so the heading
 * prerenders, and the part that depends on `searchParams` streams in behind a
 * Suspense boundary. The season lives in the URL, not in component state.
 */
export default function StandingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Championship"
        title="Standings"
        description="Points, wins and podiums for a season — computed from every classified result, not stored."
      />
      <Suspense fallback={<StandingsSkeleton />}>
        <Standings searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Standings({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // `?season=` still wins; only the default follows the configured season.
  const season = yearParam(params.season) ?? await getActiveSeason();

  const { driverStandings, constructorStandings, seasons } = await getSeasonStandings(season);

  return (
    <>
      {/* Years as links, the shape the race library already uses: picking one
          is the whole intent, so there is nothing left for a submit button to
          confirm. The requested season is always a chip, even one nobody has
          raced yet — otherwise the row would silently disagree with the URL and
          the empty state below it. No "all seasons": a championship table is
          one season by definition. */}
      <div className="mt-8">
        <SeasonFilter
          pathname="/standings"
          seasons={
            seasons.some((entry) => entry.year === season)
              ? seasons.map((entry) => entry.year)
              : [...seasons.map((entry) => entry.year), season]
          }
          active={season}
          allowAll={false}
        />
      </div>

      {driverStandings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title={`No results for ${season}`}
            description="Nothing has been imported for this season yet. Pick another, or browse the archive."
            action={
              <Link href="/races" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Browse races
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <section className="mt-10">
            <h2 className="type-section-title">
              Drivers&rsquo; championship
            </h2>

            <Card className="mt-4 overflow-x-auto p-0">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <caption className="sr-only">
                  {season} drivers&rsquo; championship standings
                </caption>
                <thead>
                  <tr className="border-b border-line text-eyebrow uppercase text-muted">
                    <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Pos</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Driver</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
                    <th scope="col" className="py-3 pr-3 text-right font-semibold">Wins</th>
                    <th scope="col" className="py-3 pr-3 text-right font-semibold">Podiums</th>
                    <th scope="col" className="py-3 pr-5 text-right font-semibold">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {driverStandings.map((standing) => (
                    <tr
                      key={standing.driver.code}
                      className="border-b border-line/60 last:border-0"
                    >
                      <td className="tabular py-2.5 pl-5 pr-3 text-muted">
                        {standing.position}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="h-4 w-1 shrink-0 rounded-full"
                            style={{ backgroundColor: standing.team.color ?? 'var(--muted)' }}
                          />
                          <span className="font-mono text-xs font-medium text-muted">
                            {standing.driver.code}
                          </span>
                          <span className="font-medium">{standing.driver.name}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-muted">{standing.team.name}</td>
                      <td className="tabular py-2.5 pr-3 text-right text-muted">
                        {standing.wins}
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right text-muted">
                        {standing.podiums}
                      </td>
                      <td className="tabular py-2.5 pr-5 text-right font-semibold">
                        {standing.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section className="mt-12">
            <h2 className="type-section-title">
              Constructors&rsquo; championship
            </h2>

            <Card className="mt-4 overflow-x-auto p-0">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <caption className="sr-only">
                  {season} constructors&rsquo; championship standings
                </caption>
                <thead>
                  <tr className="border-b border-line text-eyebrow uppercase text-muted">
                    <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Pos</th>
                    <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
                    <th scope="col" className="py-3 pr-3 text-right font-semibold">Wins</th>
                    <th scope="col" className="py-3 pr-5 text-right font-semibold">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {constructorStandings.map((standing) => (
                    <tr
                      key={standing.team.name}
                      className="border-b border-line/60 last:border-0"
                    >
                      <td className="tabular py-2.5 pl-5 pr-3 text-muted">
                        {standing.position}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="h-4 w-1 shrink-0 rounded-full"
                            style={{ backgroundColor: standing.team.color ?? 'var(--muted)' }}
                          />
                          <span className="font-medium">{standing.team.name}</span>
                        </span>
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right text-muted">
                        {standing.wins}
                      </td>
                      <td className="tabular py-2.5 pr-5 text-right font-semibold">
                        {standing.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}
    </>
  );
}

/** Sized to two filled tables, so the page does not grow as they arrive. */
function StandingsSkeleton() {
  return (
    <div className="mt-8">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="mt-10 h-8 w-72" />
      <Skeleton className="mt-4 h-[34rem] w-full rounded-xl" />
      <Skeleton className="mt-12 h-8 w-72" />
      <Skeleton className="mt-4 h-[22rem] w-full rounded-xl" />
    </div>
  );
}
