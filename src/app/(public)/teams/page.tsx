import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Entrant, ShareBar, teamWash } from '@/components/ui/results-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { GridSkeleton } from '@/components/ui/skeleton';
import { SeasonFilter } from '@/components/ui/season-filter';
import { getActiveSeason, getArchiveIndex, getSeasonStandings } from '@/lib/queries';
import { seasonFilter, type SearchParams } from '@/lib/search-params';

export const metadata = {
  title: 'Teams',
  description: 'Every constructor in the archive, with their season-by-season record.',
};

export default function TeamsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Archive"
        title="Teams"
        description="Every constructor that has entered a race in the seasons imported here. A team that rebranded appears under each name it raced with, which is how the championship counted it."
      />
      <div className="mt-8">
        <Suspense fallback={<GridSkeleton count={6} itemClassName="h-36" />}>
          <TeamGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function TeamGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const [{ teams, seasons }, standings] = await Promise.all([
    getArchiveIndex(season),
    season === null ? null : getSeasonStandings(season),
  ]);

  const filter = (
    <SeasonFilter pathname="/teams" seasons={seasons.map((entry) => entry.year)} active={season} />
  );

  if (teams.length === 0) {
    return (
      <>
        {filter}
        <div className="mt-6">
          <EmptyState
            title={season === null ? 'Nothing imported yet' : `No constructors in ${season}`}
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

  const lineups = new Map<string, string[]>();
  for (const standing of standings?.driverStandings ?? []) {
    lineups.set(standing.team.name, [...(lineups.get(standing.team.name) ?? []), standing.driver.code]);
  }
  const byName = new Map(standings?.constructorStandings.map((entry) => [entry.team.name, entry]));
  const leader = standings?.constructorStandings[0]?.points ?? 0;
  // Championship order for a season; a team with no result yet goes last.
  const ordered = teams
    .map((team) => ({ team, standing: byName.get(team.name) ?? null }))
    .sort((a, b) => (a.standing?.position ?? Infinity) - (b.standing?.position ?? Infinity));

  return (
    <>
      {filter}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map(({ team, standing }) => {
          const color = standing?.team.color ?? team.color ?? null;
          const lead = standing?.position === 1;
          return (
            <li key={team.id}>
              <Link href={`/teams/${encodeURIComponent(team.name)}`} className="block h-full rounded-xl">
                <Card interactive className="h-full" style={teamWash(color, lead)}>
                  {standing ? (
                    <span className="mb-4 flex items-end justify-between gap-3">
                      <span
                        className={`tabular font-heading text-4xl font-light leading-none ${
                          lead ? 'text-foreground' : 'text-subtle'
                        }`}
                      >
                        {standing.position}
                      </span>
                      <span className="tabular font-heading text-xl font-semibold leading-none">
                        {standing.points}
                        <span className="ml-1 text-sm font-medium text-muted">pts</span>
                      </span>
                    </span>
                  ) : null}
                  <Entrant name={team.name} color={color} large />
                  {standing ? (
                    <>
                      <span className="mt-0.5 flex justify-between gap-3 pl-[11px] text-sm text-muted">
                        <span className="font-mono">{(lineups.get(team.name) ?? []).join(' · ')}</span>
                        <span>
                          {standing.wins} win{standing.wins === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="mt-3 block pl-[11px]">
                        <ShareBar share={leader > 0 ? standing.points / leader : 0} color={color} />
                      </span>
                    </>
                  ) : null}
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
