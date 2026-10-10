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
  const years = seasons.map((entry) => entry.year).sort((a, b) => a - b);

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

  if (season === null) {
    return (
      <>
        {filter}
        <TeamHistory teams={teams} years={years} />
      </>
    );
  }

  // Everyone who drove for the team that season, a mid-season move included.
  const lineups = new Map<string, string[]>();
  for (const standing of standings?.driverStandings ?? []) {
    for (const stint of standing.stints) {
      lineups.set(stint.team.name, [...(lineups.get(stint.team.name) ?? []), standing.driver.code]);
    }
  }
  const byName = new Map(standings?.constructorStandings.map((entry) => [entry.team.name, entry]));
  const leader = standings?.constructorStandings[0]?.points ?? 0;
  // Championship order; a team with no result yet goes last.
  const ordered = teams
    .map((team) => {
      const standing = byName.get(team.name);
      return {
        team,
        color: standing?.team.color ?? team.color ?? null,
        points: standing?.points ?? null,
        wins: standing?.wins ?? 0,
        detail: (lineups.get(team.name) ?? []).join(' · '),
        position: standing?.position ?? null,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));

  return (
    <>
      {filter}
      {/* The page is the chart: each row fills to its share of the leader's
          points, so the gaps between teams are the first thing you read. */}
      <Card flush className="mt-6 overflow-hidden">
        <ol>
          {ordered.map(({ team, color, points, wins, detail, position }) => {
            const lead = position === 1;
            const share = points === null ? 1 : leader > 0 ? points / leader : 0;
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
                    {position}
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <Entrant name={team.name} color={color} />
                  </span>
                  {points !== null ? (
                    <>
                      <span className="tabular relative hidden w-32 font-mono text-xs text-muted sm:block">
                        {detail}
                      </span>
                      <span className="tabular relative hidden w-16 text-right text-sm text-muted md:block">
                        <Count value={wins} />
                        {wins > 0 ? (
                          <span className="ml-1 text-xs text-subtle">{wins === 1 ? 'win' : 'wins'}</span>
                        ) : null}
                      </span>
                      <span className="tabular relative w-16 text-right font-heading text-xl font-semibold sm:w-20">
                        {points}
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

type IndexTeam = Awaited<ReturnType<typeof getArchiveIndex>>['teams'][number];
type Finish = { position: number; color: string | null };

/**
 * All seasons, without adding them up. The archive starts in 2018, so a career
 * points total only rewards whoever has been here longest; a championship
 * place compares a team with its own season's grid and nothing else. So each
 * row is a team and each cell is where it finished that year.
 */
async function TeamHistory({ teams, years }: { teams: IndexTeam[]; years: number[] }) {
  const [activeSeason, ...tables] = await Promise.all([
    getActiveSeason(),
    ...years.map((year) => getSeasonStandings(year)),
  ]);
  const finishes = new Map<string, Map<number, Finish>>();
  years.forEach((year, i) => {
    for (const entry of tables[i].constructorStandings) {
      const row = finishes.get(entry.team.name) ?? new Map<number, Finish>();
      row.set(year, { position: entry.position, color: entry.team.color ?? null });
      finishes.set(entry.team.name, row);
    }
  });

  const rows = teams.map((team) => {
    const row = finishes.get(team.name) ?? new Map<number, Finish>();
    const raced = [...row.keys()];
    return {
      team,
      row,
      // The livery of its latest season, as every other team surface wears.
      color: row.get(Math.max(...raced))?.color ?? team.color ?? null,
      titles: [...row.values()].filter((f) => f.position === 1).length,
      last: raced.length > 0 ? Math.max(...raced) : 0,
      best: Math.min(Infinity, ...[...row.values()].map((f) => f.position)),
      now: row.get(activeSeason)?.position ?? null,
    };
  });
  const current = rows.filter((r) => r.now !== null).sort((a, b) => a.now! - b.now!);
  const gone = rows
    .filter((r) => r.now === null)
    .sort((a, b) => b.last - a.last || a.best - b.best);
  // A phone shows the latest six seasons, as the circuits table does.
  const phoneFrom = years.length - 6;

  const line = (r: (typeof rows)[number]) => (
    <tr key={r.team.id} className="relative border-b border-line/60 transition-colors last:border-0 hover:bg-panel-strong/50">
      <th scope="row" className="max-w-32 py-2 pr-2 pl-4 font-normal sm:max-w-none sm:pr-3 sm:pl-6">
        <Link
          href={`/teams/${encodeURIComponent(r.team.name)}`}
          className="block truncate after:absolute after:inset-0 after:content-[''] hover:text-accent"
        >
          <Entrant name={r.team.name} color={r.color} />
        </Link>
      </th>
      <td className="tabular hidden py-2 pr-3 text-center text-sm md:table-cell">
        {r.titles > 0 ? r.titles : <span className="text-subtle">·</span>}
      </td>
      {years.map((year, index) => {
        const finish = r.row.get(year);
        return (
          <td key={year} className={`px-0.5 py-1.5 text-center ${index < phoneFrom ? 'hidden sm:table-cell' : ''}`}>
            {finish ? (
              <span
                className={`tabular inline-flex h-7 w-8 items-center sm:w-9 justify-center rounded-md text-xs font-semibold ${
                  finish.position === 1 ? 'text-foreground' : 'text-muted'
                }`}
                // Stronger for a higher place, so the champions read first.
                style={{
                  backgroundColor: `color-mix(in oklab, ${finish.color ?? 'var(--muted)'} ${Math.max(6, 30 - (finish.position - 1) * 3)}%, transparent)`,
                }}
              >
                P{finish.position}
              </span>
            ) : (
              <span className="text-subtle" aria-label={`${year}: did not race`}>·</span>
            )}
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <p className="mt-6 text-xs text-muted">
        Constructors&rsquo; championship place each season. The stronger the tint, the higher the place.
      </p>
      <Card flush className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Constructors&rsquo; championship place by season</caption>
          <thead>
            <tr className="border-b border-line text-eyebrow uppercase text-muted">
              <th scope="col" className="py-2.5 pr-3 pl-4 font-semibold sm:pl-6">Team</th>
              <th scope="col" className="hidden w-16 py-2.5 pr-3 text-center font-semibold md:table-cell">Titles</th>
              {years.map((year, index) => (
                <th
                  key={year}
                  scope="col"
                  className={`tabular w-9 py-2.5 text-center font-semibold sm:w-10 ${index < phoneFrom ? 'hidden sm:table-cell' : ''}`}
                >
                  <span aria-hidden>’{String(year).slice(2)}</span>
                  <span className="sr-only">{year}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {current.map(line)}
            {gone.length > 0 ? (
              <tr className="border-b border-line/60">
                <th
                  scope="rowgroup"
                  colSpan={years.length + 2}
                  className="bg-panel-strong/40 py-2 pl-4 text-left text-eyebrow font-semibold uppercase text-muted sm:pl-6"
                >
                  No longer racing
                </th>
              </tr>
            ) : null}
            {gone.map(line)}
          </tbody>
        </table>
      </Card>
    </>
  );
}
