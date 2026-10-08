import { RacePageShell, StoryPanel, raceStaticParams, raceMetadata } from '../race-view';

/**
 * The race detail page, on its Story tab: the replay's chart held in place
 * while the race's key moments scroll past it. Same payload as the replay, so
 * a third tab costs a prerender, not another query shape.
 */
export const generateStaticParams = raceStaticParams;

// Blocks on purpose, for the same reason as the replay and analysis routes: the
// existence check and its notFound() sit above Suspense in RacePageShell.
export const instant = false;

export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) =>
  raceMetadata(params, (name, season) => ({
    title: `${name} story`,
    description: `The ${season} ${name}, told lap by lap.`,
  }));

export default async function RaceStoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RacePageShell params={params} view="story">
      <StoryPanel slug={slug} />
    </RacePageShell>
  );
}
