import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Entrant, teamWash } from '@/components/ui/results-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { GridSkeleton } from '@/components/ui/skeleton';
import { SeasonFilter } from '@/components/ui/season-filter';
import { getActiveSeason, getArchiveIndex, getSeasonStandings } from '@/lib/queries';
import { seasonFilter, type SearchParams } from '@/lib/search-params';

export const metadata = {
  title: 'Drivers',
  description: 'Every driver in the archive, with their season-by-season record.',
};

export default function DriversPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Archive"
        title="Drivers"
        description="Everyone who has started a race in the seasons imported here."
      />
      <div className="mt-8">
        <Suspense fallback={<GridSkeleton count={9} itemClassName="h-36" />}>
          <DriverGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function DriverGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const [{ drivers, seasons }, standings, activeSeason] = await Promise.all([
    getArchiveIndex(season),
    season === null ? null : getSeasonStandings(season),
    getActiveSeason(),
  ]);

  const filter = (
    <SeasonFilter pathname="/drivers" seasons={seasons.map((entry) => entry.year)} active={season} />
  );

  if (drivers.length === 0) {
    return (
      <>
        {filter}
        <div className="mt-6">
          <EmptyState
            title={season === null ? 'Nothing imported yet' : `No drivers in ${season}`}
            description={
              season === null
                ? 'Import a season and they appear here.'
                : 'That season has not been imported, or nothing has been matched to it yet.'
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {filter}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lineup(drivers, standings, season).map(({ driver, standing, team }) => (
          <li key={driver.id}>
            <Link href={`/drivers/${driver.code.toLowerCase()}`} className="block h-full rounded-xl">
              <Card interactive className="h-full" style={teamWash(team?.color ?? null)}>
                <span className="flex items-start justify-between gap-3">
                  {/* The number is the one a driver carries now; an old season
                      may have seen another, so it shows only for this one. */}
                  <span className="tabular font-heading text-4xl font-light leading-none text-subtle">
                    {driver.number !== null && (season === null || season === activeSeason)
                      ? driver.number
                      : null}
                  </span>
                  {standing ? (
                    <span className="text-right">
                      <span className="tabular block font-heading text-xl font-semibold leading-none">
                        {standing.points}
                        <span className="ml-1 text-sm font-medium text-muted">pts</span>
                      </span>
                      <span className="mt-1 block text-eyebrow font-semibold uppercase text-muted">
                        P{standing.position}
                      </span>
                    </span>
                  ) : null}
                </span>
                <span className="mt-4 block">
                  <Entrant code={driver.code} name={driver.name} color={team?.color ?? null} large />
                </span>
                <span className="mt-0.5 block truncate pl-[11px] text-sm text-muted">
                  {[team?.name, driver.country].filter(Boolean).join(' · ') || '\u00a0'}
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

type IndexDriver = Awaited<ReturnType<typeof getArchiveIndex>>['drivers'][number];
type Standings = Awaited<ReturnType<typeof getSeasonStandings>>;

/**
 * A season reads as the grid: teams in championship order, teammates side by
 * side, so this is not the standings table again. All seasons is alphabetical,
 * each driver in the colours they last raced in.
 */
function lineup(drivers: IndexDriver[], standings: Standings | null, season: number | null) {
  if (season === null || standings === null) {
    return drivers.map((driver) => ({ driver, standing: null, team: driver.latestTeam ?? null }));
  }
  const byCode = new Map(standings.driverStandings.map((standing) => [standing.driver.code, standing]));
  const teamOrder = new Map(standings.constructorStandings.map((entry) => [entry.team.name, entry.position]));
  return drivers
    .map((driver) => {
      const standing = byCode.get(driver.code) ?? null;
      return { driver, standing, team: standing?.team ?? null };
    })
    .sort(
      (a, b) =>
        (teamOrder.get(a.team?.name ?? '') ?? Infinity) - (teamOrder.get(b.team?.name ?? '') ?? Infinity) ||
        (a.standing?.position ?? Infinity) - (b.standing?.position ?? Infinity),
    );
}
