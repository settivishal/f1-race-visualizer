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
        <Suspense fallback={<GridSkeleton count={9} itemClassName="h-16" />}>
          <DriverGrid searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}

async function DriverGrid({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const season = await seasonFilter(params.season, getActiveSeason);

  const { drivers, seasons } = await getArchiveIndex(season);

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
      {drivers.map((driver) => (
        <li key={driver.id}>
          <Link href={`/drivers/${driver.code.toLowerCase()}`} className="block rounded-xl">
            <Card interactive className="flex items-center gap-3">
              <span className="font-mono text-sm font-semibold text-muted">{driver.code}</span>
              <span className="font-medium">{driver.name}</span>
              {driver.country ? (
                <span className="ml-auto text-xs text-subtle">{driver.country}</span>
              ) : null}
            </Card>
          </Link>
        </li>
      ))}
    </ul>
    </>
  );
}
