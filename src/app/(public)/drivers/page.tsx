import { Suspense } from 'react';
import { DriverGarages, type Garage, type GaragePanel } from '@/components/archive/driver-garages';
import { span } from '@/components/ui/results-table';
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

  const [{ drivers, teams, seasons }, standings, activeSeason] = await Promise.all([
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
      <DriverGarages garages={garages(drivers, teams, standings, showNumbers)} />
    </>
  );
}

type Index = Awaited<ReturnType<typeof getArchiveIndex>>;
type IndexDriver = Index['drivers'][number];
type Standings = Awaited<ReturnType<typeof getSeasonStandings>>;
type DriverStanding = Standings['driverStandings'][number];
type Stint = DriverStanding['stints'][number];

const winsNote = (wins: number) => (wins > 0 ? `${wins} win${wins === 1 ? '' : 's'}` : null);

function panel(
  driver: IndexDriver,
  standing: DriverStanding | null,
  showNumbers: boolean,
  // Set only for a driver who raced for more than one team that season: the
  // panel in this garage shows what they scored here, and when.
  stint: Stint | null = null,
): GaragePanel {
  const base = {
    id: driver.id, code: driver.code, name: driver.name, country: driver.country ?? null,
    // A past season has no number to show (only today's is stored), so the
    // numeral becomes the championship position, as in the standings.
    numeral: showNumbers ? (driver.number ?? null) : (standing?.position ?? null),
    lit: !showNumbers && standing?.position === 1,
  };
  if (standing) {
    const rounds = stint?.fromRound == null ? null
      : stint.fromRound === stint.toRound ? `Round ${stint.fromRound}`
      : `Rounds ${stint.fromRound}–${stint.toRound}`;
    return {
      ...base,
      points: stint?.points ?? standing.points,
      note: [
        showNumbers ? `P${standing.position}` : null,
        rounds,
        winsNote(stint?.wins ?? standing.wins),
      ].filter((part): part is string => part !== null),
    };
  }
  const career = driver.career;
  if (career && career.seasons.length > 0) {
    return {
      ...base,
      points: career.points,
      note: [span(career.seasons), winsNote(career.wins)].filter((part): part is string => part !== null),
    };
  }
  return { ...base, points: null, note: [] };
}

/**
 * The grid, one garage per team. A season lines the teams up in championship
 * order with each driver under every team they scored for; all seasons puts
 * each driver in the garage they last raced from, teams A–Z, best career
 * first. Anyone the standings do not place — a season with no result yet —
 * waits in a garage of their own.
 */
function garages(
  drivers: IndexDriver[],
  teams: Index['teams'],
  standings: Standings | null,
  showNumbers: boolean,
): Garage[] {
  if (standings === null) {
    const spans = new Map(teams.map((team) => [team.name, team.career ? span(team.career.seasons) : null]));
    const byTeam = new Map<string, Garage & { drivers: IndexDriver[] }>();
    for (const driver of drivers) {
      const team = driver.latestTeam ?? null;
      const key = team?.name ?? '';
      const garage = byTeam.get(key)
        ?? { key, team, standing: null, span: spans.get(key) ?? null, share: 0, panels: [], drivers: [] };
      garage.drivers.push(driver);
      byTeam.set(key, garage);
    }
    return [...byTeam.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ drivers: inGarage, ...garage }) => ({
        ...garage,
        panels: inGarage
          .sort((a, b) => (b.career?.points ?? 0) - (a.career?.points ?? 0))
          .map((driver) => panel(driver, null, showNumbers)),
      }));
  }

  const byCode = new Map(standings.driverStandings.map((standing) => [standing.driver.code, standing]));
  const leader = standings.constructorStandings[0]?.points ?? 0;
  const result: Garage[] = standings.constructorStandings.map((entry) => ({
    key: entry.team.name,
    team: { name: entry.team.name, color: entry.team.color ?? null },
    standing: entry,
    span: null,
    share: leader > 0 ? entry.points / leader : 0,
    panels: drivers
      .flatMap((driver) => {
        const standing = byCode.get(driver.code);
        const stint = standing?.stints.find((s) => s.team.name === entry.team.name);
        if (!standing || !stint) return [];
        return [{ standing, panel: panel(driver, standing, showNumbers, standing.stints.length > 1 ? stint : null) }];
      })
      .sort((a, b) => a.standing.position - b.standing.position)
      .map(({ panel }) => panel),
  }));
  const unplaced = drivers.filter((driver) => !byCode.has(driver.code));
  if (unplaced.length > 0) {
    result.push({
      key: '',
      team: null,
      standing: null,
      span: null,
      share: 0,
      panels: unplaced.map((driver) => panel(driver, null, showNumbers)),
    });
  }
  return result.filter((garage) => garage.panels.length > 0);
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
