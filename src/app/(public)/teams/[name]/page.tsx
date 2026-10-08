import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { ProfileSkeleton } from '@/components/ui/skeleton';
import { RecordTable, StatRow } from '@/components/archive/record-table';
import { getArchiveIndex, getTeamProfile } from '@/lib/queries';
import { prerenderParams } from '@/lib/prerender';
import { BackLink } from '@/components/ui/back-link';

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
  // The raw name: Next encodes params itself, and encoding here too baked a 404
  // into every team with a space in its name ("Aston%2520Martin").
  return prerenderParams(teams.map((team) => ({ name: team.name })));
}

// Blocks on purpose: the existence check and its notFound() sit above Suspense
// in this page, because below a boundary they bake the 404 into the prerendered
// shell. Without this, next dev flags the awaited params as non-instant.
export const instant = false;

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
      <BackLink href="/teams">All teams</BackLink>

      <Suspense fallback={<ProfileSkeleton subtitleClassName="w-72" />}>
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
