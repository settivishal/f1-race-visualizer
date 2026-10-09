import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Entrant, ShareBar, teamWash } from '@/components/ui/results-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
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
        <Suspense fallback={<GarageSkeleton />}>
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

  // The number is the one a driver carries now; an old season may have seen
  // another, so it shows only where "now" is what the page is about.
  const showNumbers = season === null || season === activeSeason;

  return (
    <>
      {filter}
      <ul className="mt-6 space-y-3">
        {garages(drivers, standings).map((garage) => (
          <li key={garage.key}>
            <Garage garage={garage} showNumbers={showNumbers} />
          </li>
        ))}
      </ul>
    </>
  );
}

type IndexDriver = Awaited<ReturnType<typeof getArchiveIndex>>['drivers'][number];
type Standings = Awaited<ReturnType<typeof getSeasonStandings>>;
type DriverStanding = Standings['driverStandings'][number];
type Garage = {
  key: string;
  team: { name: string; color: string | null } | null;
  standing: { position: number; points: number } | null;
  share: number;
  drivers: { driver: IndexDriver; standing: DriverStanding | null }[];
};

/**
 * The grid, one garage per team. A season lines the teams up in championship
 * order with each driver under the team they scored for; all seasons puts each
 * driver in the garage they last raced from, teams A–Z. Anyone the standings do
 * not place — a season with no result yet — waits in a garage of their own.
 */
function garages(drivers: IndexDriver[], standings: Standings | null): Garage[] {
  if (standings === null) {
    const byTeam = new Map<string, Garage>();
    for (const driver of drivers) {
      const team = driver.latestTeam ?? null;
      const key = team?.name ?? '';
      const garage = byTeam.get(key) ?? { key, team, standing: null, share: 0, drivers: [] };
      garage.drivers.push({ driver, standing: null });
      byTeam.set(key, garage);
    }
    return [...byTeam.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  const byCode = new Map(standings.driverStandings.map((standing) => [standing.driver.code, standing]));
  const leader = standings.constructorStandings[0]?.points ?? 0;
  const result: Garage[] = standings.constructorStandings.map((entry) => ({
    key: entry.team.name,
    team: { name: entry.team.name, color: entry.team.color ?? null },
    standing: entry,
    share: leader > 0 ? entry.points / leader : 0,
    drivers: drivers
      .filter((driver) => byCode.get(driver.code)?.team.name === entry.team.name)
      .map((driver) => ({ driver, standing: byCode.get(driver.code) ?? null }))
      .sort((a, b) => (a.standing?.position ?? 0) - (b.standing?.position ?? 0)),
  }));
  const unplaced = drivers.filter((driver) => !result.some((garage) => garage.drivers.some((d) => d.driver === driver)));
  if (unplaced.length > 0) {
    result.push({
      key: '',
      team: null,
      standing: null,
      share: 0,
      drivers: unplaced.map((driver) => ({ driver, standing: null })),
    });
  }
  return result.filter((garage) => garage.drivers.length > 0);
}

function Garage({ garage, showNumbers }: { garage: Garage; showNumbers: boolean }) {
  const color = garage.team?.color ?? null;
  const header = (
    <>
      <Entrant name={garage.team?.name ?? 'Entered'} color={color} large />
      {garage.standing ? (
        <>
          <span className="tabular mt-1 block pl-[11px] text-sm text-muted">
            P{garage.standing.position} · {garage.standing.points} pts
          </span>
          <span className="mt-3 block pl-[11px]">
            <ShareBar share={garage.share} color={color} />
          </span>
        </>
      ) : null}
    </>
  );

  return (
    <Card flush className="overflow-hidden md:flex"
      style={garage.team ? teamWash(color, garage.standing?.position === 1) : undefined}
    >
      {garage.team ? (
        <Link
          href={`/teams/${encodeURIComponent(garage.team.name)}`}
          className="block shrink-0 border-b border-line/60 p-4 transition-colors hover:bg-panel-strong/50 sm:p-5 md:w-60 md:border-r md:border-b-0"
        >
          {header}
        </Link>
      ) : (
        <div className="shrink-0 border-b border-line/60 p-4 sm:p-5 md:w-60 md:border-r md:border-b-0">{header}</div>
      )}
      <ul className="grid flex-1 grid-cols-2 [&>li:nth-child(even)]:border-l [&>li:nth-child(n+3)]:border-t [&>li]:border-line/60">
        {garage.drivers.map(({ driver, standing }) => {
          // A past season has no number to show (only today's is stored), so
          // the numeral becomes the championship position, as in the standings.
          const numeral = showNumbers ? driver.number : (standing?.position ?? null);
          const note = [
            showNumbers && standing ? `P${standing.position}` : null,
            standing && standing.wins > 0 ? `${standing.wins} win${standing.wins === 1 ? '' : 's'}` : null,
          ].filter(Boolean);
          return (
            <li key={driver.id}>
              <Link
                href={`/drivers/${driver.code.toLowerCase()}`}
                className="flex h-full flex-col justify-between gap-3 p-4 transition-colors hover:bg-panel-strong/50 sm:p-5"
              >
                <span className="flex items-start justify-between gap-3">
                  <span
                    className={`tabular font-heading text-3xl font-light leading-none sm:text-4xl ${
                      !showNumbers && numeral === 1 ? 'text-foreground' : 'text-subtle'
                    }`}
                  >
                    {numeral}
                  </span>
                  {standing ? (
                    <span className="text-right">
                      <span className="tabular block font-heading text-lg font-semibold leading-none sm:text-xl">
                        {standing.points}
                        <span className="ml-1 text-xs font-medium text-muted sm:text-sm">pts</span>
                      </span>
                      {note.length > 0 ? (
                        <span className="tabular mt-1 block text-xs text-muted">{note.join(' · ')}</span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span className="block min-w-0">
                  {/* Two panels share a phone's width, so there the code leads and
                      the name wraps under it rather than being cut off. */}
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground sm:text-muted">{driver.code}</span>
                    <span className="hidden truncate font-medium sm:inline">{driver.name}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted sm:hidden">{driver.name}</span>
                  {driver.country ? (
                    <span className="mt-0.5 hidden truncate text-xs text-subtle sm:block">{driver.country}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function GarageSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full max-w-2xl" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-32 w-full rounded-xl" />
      ))}
    </div>
  );
}
