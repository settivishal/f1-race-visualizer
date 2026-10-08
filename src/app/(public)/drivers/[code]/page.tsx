import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { ProfileSkeleton } from '@/components/ui/skeleton';
import { RecordTable, StatRow } from '@/components/archive/record-table';
import { getArchiveIndex, getDriverProfile } from '@/lib/queries';
import { prerenderParams } from '@/lib/prerender';
import { BackLink } from '@/components/ui/back-link';

/**
 * A driver's record across the seasons in the database.
 *
 * Deliberately not called a career: this covers what has been imported, which
 * is 2018 onward, and the page says so rather than implying a driver who raced
 * before that started here.
 */
export async function generateStaticParams() {
  const { drivers } = await getArchiveIndex();
  return prerenderParams(drivers.map((driver) => ({ code: driver.code.toLowerCase() })));
}

// Blocks on purpose: the existence check and its notFound() sit above Suspense
// in this page, because below a boundary they bake the 404 into the prerendered
// shell. Without this, next dev flags the awaited params as non-instant.
export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { driver } = await getDriverProfile(code);

  if (!driver) return { title: 'Driver not found' };
  return {
    title: `${driver.driver.name}`,
    description: `Season-by-season record for ${driver.driver.name}.`,
  };
}

/**
 * The existence check runs here, above the Suspense boundary, and not in the
 * detail component below it.
 *
 * It used to run below, and that broke every one of these pages in production:
 * with Cache Components the shell is prerendered on its own, `notFound()` fired
 * while the shell was being generated, and so the prerendered shell *was* the
 * 404 page. Production then served that shell for a row that exists perfectly
 * well. Locally in `next dev` there is no separate shell, which is why it
 * looked fine every time.
 *
 * Awaiting the profile here costs a cache read — `generateMetadata` above
 * already awaits the same one — and makes the 404 a real 404 instead of a 200
 * that renders like one.
 */
export default async function DriverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { driver: exists } = await getDriverProfile(code);

  if (!exists) notFound();

  return (
    <PageContainer>
      <BackLink href="/drivers">All drivers</BackLink>

      <Suspense fallback={<ProfileSkeleton />}>
        <DriverDetail params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function DriverDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { driver: profile } = await getDriverProfile(code);

  if (!profile) notFound();

  const { driver, career } = profile;
  const latest = career.seasons[0];

  return (
    <>
      <div className="mt-5">
        <SectionHeader
          eyebrow={`${driver.code}${driver.number !== null ? ` · #${driver.number}` : ''}`}
          title={driver.name}
          description={`${driver.country ?? 'Nationality unknown'}${
            latest?.team ? ` · ${latest.team.name} in ${latest.season}` : ''
          }`}
        />
      </div>

      <div className="mt-8">
        <StatRow
          stats={[
            { label: 'Seasons', value: String(career.seasonCount) },
            { label: 'Starts', value: String(career.starts) },
            { label: 'Wins', value: String(career.wins) },
            { label: 'Podiums', value: String(career.podiums) },
            { label: 'Best', value: career.bestFinish === null ? '—' : `P${career.bestFinish}` },
            { label: 'Points', value: String(career.points) },
          ]}
        />
      </div>

      <section className="mt-10">
        <h2 className="type-section-title">By season</h2>
        {/* The honest caveat, on the page rather than in a comment: these are
            the seasons this database holds, not a career total. */}
        <p className="mt-2 text-sm text-muted">
          Covering the seasons imported here. Wins and podiums count grands prix, not sprints.
        </p>
        <div className="mt-4">
          <RecordTable
            caption={`${driver.name}'s record by season`}
            rows={career.seasons.map((season) => ({
              season: season.season,
              teamName: season.team?.name ?? null,
              teamColor: season.team?.color ?? null,
              starts: season.starts,
              wins: season.wins,
              podiums: season.podiums,
              points: season.points,
              bestFinish: season.bestFinish ?? null,
            }))}
          />
        </div>
      </section>
    </>
  );
}
