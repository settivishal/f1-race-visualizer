import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { RecordTable, StatRow } from '@/components/archive/record-table';
import { getArchiveIndex, getTeamProfile } from '@/lib/queries';
import { prerenderParams } from '@/lib/prerender';

/**
 * A constructor's record.
 *
 * The URL carries the team's name, encoded — "Red Bull Racing" — rather than a
 * slug, because the name is the key the database already enforces as unique and
 * a slug would be a second identifier to keep in step with it. A team that
 * rebrands genuinely becomes a different row, which is what the standings
 * already assume.
 */
export async function generateStaticParams() {
  const { teams } = await getArchiveIndex();
  return prerenderParams(teams.map((team) => ({ name: encodeURIComponent(team.name) })));
}

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { team } = await getTeamProfile(decodeURIComponent(name));

  if (!team) return { title: 'Team not found' };
  return {
    title: `${team.team.name}`,
    description: `Season-by-season record for ${team.team.name}.`,
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
export default async function TeamPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { team: exists } = await getTeamProfile(decodeURIComponent(name));

  if (!exists) notFound();

  return (
    <PageContainer>
      <Link
        href="/teams"
        className="inline-flex rounded-sm text-eyebrow font-semibold uppercase text-muted transition-colors hover:text-foreground"
      >
        ← All teams
      </Link>

      <Suspense fallback={<ProfileSkeleton />}>
        <TeamDetail params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function TeamDetail({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { team: profile } = await getTeamProfile(decodeURIComponent(name));

  if (!profile) notFound();

  const { team, career, drivers } = profile;

  return (
    <>
      <header className="mt-5 flex items-start gap-4">
        <span
          className="mt-3 h-12 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: team.color ?? 'var(--muted)' }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <SectionHeader
            eyebrow="Constructor"
            title={team.name}
            description={
              drivers.length > 0
                ? drivers.map((driver) => driver.name).join(' · ')
                : 'No drivers recorded'
            }
          />
        </div>
      </header>

      <div className="mt-8">
        <StatRow
          stats={[
            { label: 'Seasons', value: String(career.seasonCount) },
            { label: 'Entries', value: String(career.starts) },
            { label: 'Wins', value: String(career.wins) },
            { label: 'Podiums', value: String(career.podiums) },
            { label: 'Best', value: career.bestFinish === null ? '—' : `P${career.bestFinish}` },
            { label: 'Points', value: String(career.points) },
          ]}
        />
      </div>

      <section className="mt-10">
        <h2 className="type-section-title">By season</h2>
        <p className="mt-2 text-sm text-muted">
          Covering the seasons imported here. Entries count both cars, so a full season is
          twice the number of races.
        </p>
        <div className="mt-4">
          <RecordTable
            showTeam={false}
            caption={`${team.name}'s record by season`}
            rows={career.seasons.map((season) => ({
              season: season.season,
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

function ProfileSkeleton() {
  return (
    <div className="mt-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-12 w-80 max-w-full" />
      <Skeleton className="mt-3 h-5 w-72" />
      <Skeleton className="mt-8 h-24 w-full rounded-xl" />
      <Skeleton className="mt-10 h-72 w-full rounded-xl" />
    </div>
  );
}
