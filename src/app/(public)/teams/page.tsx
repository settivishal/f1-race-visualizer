import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Count, Entrant, teamWash } from '@/components/ui/results-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
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
        <Suspense fallback={<Skeleton className="h-[40rem] w-full rounded-xl" />}>
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
      {/* The page is the chart: each row fills to its share of the leader's
          points, so the gaps between teams are the first thing you read. */}
      <Card flush className="mt-6 overflow-hidden">
        <ol>
          {ordered.map(({ team, standing }) => {
            const color = standing?.team.color ?? team.color ?? null;
            const lead = standing?.position === 1;
            const share = standing ? (leader > 0 ? standing.points / leader : 0) : 1;
            return (
              <li key={team.id} className="border-b border-line/60 last:border-0">
                <Link
                  href={`/teams/${encodeURIComponent(team.name)}`}
                  className="relative flex h-14 items-center gap-3 pr-4 transition-colors hover:bg-panel-strong/50 sm:gap-4 sm:pr-6"
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0"
                    // The same top edge and wash every team card wears; here it
                    // just stops where the points do.
                    style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, ...teamWash(color, lead) }}
                  />
                  <span
                    className={`tabular relative w-10 shrink-0 pl-4 font-heading text-2xl font-light leading-none sm:w-14 sm:pl-6 ${
                      lead ? 'text-foreground' : 'text-subtle'
                    }`}
                  >
                    {standing?.position}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <Entrant name={team.name} color={color} />
                  </span>
                  {standing ? (
                    <>
                      <span className="relative hidden w-32 font-mono text-xs text-muted sm:block">
                        {(lineups.get(team.name) ?? []).join(' · ')}
                      </span>
                      <span className="tabular relative hidden w-16 text-right text-sm text-muted md:block">
                        <Count value={standing.wins} />
                        {standing.wins > 0 ? (
                          <span className="ml-1 text-xs text-subtle">{standing.wins === 1 ? 'win' : 'wins'}</span>
                        ) : null}
                      </span>
                      <span className="tabular relative w-16 text-right font-heading text-xl font-semibold sm:w-20">
                        {standing.points}
                      </span>
                    </>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
