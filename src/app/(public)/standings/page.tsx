import { Suspense } from 'react';
import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SeasonFilter } from '@/components/ui/season-filter';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CELL,
  Entrant,
  FIRST,
  LAST,
  Count,
  ResultsTable,
  ShareBar,
  Row,
  TopThree,
  type Place,
} from '@/components/ui/results-table';
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

            <ResultsTable
              caption={`${season} drivers’ championship standings`}
              top={topThree(driverStandings, (standing) => ({
                code: standing.driver.code,
                title: standing.driver.name,
                subtitle: standing.team.name,
              }))}
              columns={[
                { label: 'Pos' },
                { label: 'Driver', className: 'md:w-64' },
                { label: 'Team', className: 'hidden md:table-cell' },
                { label: 'Share of leader', className: 'hidden w-32 md:table-cell', srOnly: true },
                { label: 'Wins', className: 'w-16 text-right' },
                { label: 'Podiums', className: 'hidden w-20 text-right sm:table-cell' },
                { label: 'Pts' },
              ]}
            >
              {rest(driverStandings).map((standing) => (
                <Row key={standing.driver.code}>
                  <td className={FIRST}>{standing.position}</td>
                  <td className={CELL}>
                    <Entrant
                      code={standing.driver.code}
                      name={standing.driver.name}
                      color={standing.team.color ?? null}
                    />
                  </td>
                  <td className={`${CELL} hidden truncate text-muted md:table-cell`}>{standing.team.name}</td>
                  <td className={`${CELL} hidden md:table-cell`}>
                    <ShareBar share={share(driverStandings, standing)} color={standing.team.color ?? null} />
                  </td>
                  <td className={`${CELL} tabular text-right text-muted`}>
                    <Count value={standing.wins} />
                  </td>
                  <td className={`${CELL} tabular hidden text-right text-muted sm:table-cell`}>
                    <Count value={standing.podiums} />
                  </td>
                  <td className={`${LAST} font-semibold`}>{standing.points}</td>
                </Row>
              ))}
            </ResultsTable>
          </section>

          <section className="mt-12">
            <h2 className="type-section-title">
              Constructors&rsquo; championship
            </h2>

            <ResultsTable
              caption={`${season} constructors’ championship standings`}
              top={topThree(constructorStandings, (standing) => ({ title: standing.team.name }))}
              columns={[
                { label: 'Pos' },
                { label: 'Team' },
                { label: 'Share of leader', className: 'hidden w-40 md:table-cell', srOnly: true },
                { label: 'Wins', className: 'w-16 text-right' },
                { label: 'Pts' },
              ]}
            >
              {rest(constructorStandings).map((standing) => (
                <Row key={standing.team.name}>
                  <td className={FIRST}>{standing.position}</td>
                  <td className={CELL}>
                    <Entrant name={standing.team.name} color={standing.team.color ?? null} />
                  </td>
                  <td className={`${CELL} hidden md:table-cell`}>
                    <ShareBar
                      share={share(constructorStandings, standing)}
                      color={standing.team.color ?? null}
                    />
                  </td>
                  <td className={`${CELL} tabular text-right text-muted`}>
                    <Count value={standing.wins} />
                  </td>
                  <td className={`${LAST} font-semibold`}>{standing.points}</td>
                </Row>
              ))}
            </ResultsTable>
          </section>
        </>
      )}
    </>
  );
}

type Standing = {
  position: number;
  points: number;
  wins: number;
  team: { name: string; color?: string | null };
};

/** The strip needs a full top three; anything less stays in the table. */
function hasTopThree(standings: Standing[]) {
  return standings.length >= 3;
}

/** Points over the leader's; a season where nobody has scored is all zeros. */
function share(standings: Standing[], standing: Standing) {
  const leader = standings[0]?.points ?? 0;
  return leader > 0 ? standing.points / leader : 0;
}

function rest<T extends Standing>(standings: T[]) {
  return hasTopThree(standings) ? standings.slice(3) : standings;
}

/** P1 shows its wins; P2 and P3 how far they trail it. */
function topThree<T extends Standing>(
  standings: T[],
  entrant: (standing: T) => Pick<Place, 'code' | 'title' | 'subtitle'>,
) {
  if (!hasTopThree(standings)) return null;
  const leader = standings[0].points;
  return (
    <TopThree
      label="Top three"
      leadLabel="Leader"
      places={standings.slice(0, 3).map((standing) => {
        const gap = leader - standing.points;
        return {
          ...entrant(standing),
          position: standing.position,
          color: standing.team.color ?? null,
          points: standing.points,
          share: share(standings, standing),
          note:
            standing.position === 1
              ? `${standing.wins} win${standing.wins === 1 ? '' : 's'}`
              : gap === 0
                ? 'Level on points'
                : `−${gap} to leader`,
        };
      })}
    />
  );
}

/** Sized to two filled tables, so the page does not grow as they arrive. */
function StandingsSkeleton() {
  return (
    <div className="mt-8">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="mt-10 h-8 w-72" />
      <Skeleton className="mt-4 h-[42rem] w-full rounded-xl" />
      <Skeleton className="mt-12 h-8 w-72" />
      <Skeleton className="mt-4 h-[26rem] w-full rounded-xl" />
    </div>
  );
}
