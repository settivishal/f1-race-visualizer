import { getRaceHeader } from '@/lib/queries';
import { sessionTitle } from '@/lib/session-title';
import { RacePageShell, ReplayPanel, raceStaticParams } from './race-view';

/**
 * The race detail page, on its Replay tab. Analysis is its own route beside
 * this one, so neither reads the query string to decide what to render.
 *
 * The replay is its own cached query and its own Suspense boundary. It is the
 * one payload in the application large enough to matter — every lap of every
 * driver — so the header and the classification render without waiting on it.
 */
export const generateStaticParams = raceStaticParams;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  if (!race) return { title: 'Race not found' };

  const name = race.meeting ? sessionTitle(race.meeting.name, race.type) : race.slug;
  return {
    title: `${name}`,
    description: `Lap-by-lap replay of the ${race.meeting?.season ?? ''} ${name}.`.trim(),
  };
}

export default async function RacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RacePageShell params={params} view="replay">
      <ReplayPanel slug={slug} />
    </RacePageShell>
  );
}
