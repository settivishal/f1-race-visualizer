import { getRaceHeader } from '@/lib/queries';
import { sessionTitle } from '@/lib/session-title';
import { RacePageShell, StoryPanel, raceStaticParams } from '../race-view';

/**
 * The race detail page, on its Story tab: the replay's chart held in place
 * while the race's key moments scroll past it. Same payload as the replay, so
 * a third tab costs a prerender, not another query shape.
 */
export const generateStaticParams = raceStaticParams;

// Blocks on purpose, for the same reason as the replay and analysis routes: the
// existence check and its notFound() sit above Suspense in RacePageShell.
export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  if (!race) return { title: 'Race not found' };

  const name = race.meeting ? sessionTitle(race.meeting.name, race.type) : race.slug;
  return {
    title: `${name} story`,
    description: `The ${race.meeting?.season ?? ''} ${name}, told lap by lap.`.trim(),
  };
}

export default async function RaceStoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RacePageShell params={params} view="story">
      <StoryPanel slug={slug} />
    </RacePageShell>
  );
}
