import { Suspense } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { GridSkeleton } from '@/components/ui/skeleton';
import { SeasonFilter } from '@/components/ui/season-filter';
import { getActiveSeason, getArchiveIndex } from '@/lib/queries';
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
        <Suspense fallback={<GridSkeleton count={6} itemClassName="h-16" />}>
          <TeamGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function TeamGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const { teams, seasons } = await getArchiveIndex(season);

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

  return (
    <>
      {filter}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((team) => (
        <li key={team.id}>
          <Link href={`/teams/${encodeURIComponent(team.name)}`} className="block rounded-xl">
            <Card interactive className="flex items-center gap-3">
              <span
                className="h-6 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: team.color ?? 'var(--muted)' }}
                aria-hidden
              />
              <span className="font-medium">{team.name}</span>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
    </>
  );
}
