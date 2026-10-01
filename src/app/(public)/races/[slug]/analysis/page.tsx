import { Suspense } from 'react';
import { getRaceHeader } from '@/lib/queries';
import { sessionTitle } from '@/lib/session-title';
import { AnalysisPanel } from '../analysis-panel';
import { AnalysisSkeleton, RacePageShell, raceStaticParams } from '../race-view';

/**
 * The race detail page, on its Analysis tab.
 *
 * A route of its own rather than `?view=analysis` on the race page, so the tab
 * is decided by the path and the page is prerendered with its charts. Old
 * `?view=analysis` links are redirected here in `next.config.ts`.
 */
export const generateStaticParams = raceStaticParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  if (!race) return { title: 'Race not found' };

  const name = race.meeting ? sessionTitle(race.meeting.name, race.type) : race.slug;
  return {
    title: `${name} analysis`,
    description: `Lap times, tyre strategy and pace from the ${race.meeting?.season ?? ''} ${name}.`.trim(),
  };
}

export default async function RaceAnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}) {
  const { slug } = await params;
  return (
    <RacePageShell params={params} view="analysis">
      <div className="mt-8">
        <Suspense fallback={<AnalysisSkeleton />}>
          <AnalysisPanel slug={slug} searchParams={searchParams} />
        </Suspense>
      </div>
    </RacePageShell>
  );
}
