import { RacePageShell, ReplayPanel, raceStaticParams, raceMetadata } from './race-view';

/**
 * The race detail page, on its Replay tab. Analysis is its own route beside
 * this one, so neither reads the query string to decide what to render.
 *
 * The replay is its own cached query and its own Suspense boundary. It is the
 * one payload in the application large enough to matter — every lap of every
 * driver — so the header and the classification render without waiting on it.
 */
export const generateStaticParams = raceStaticParams;

// Blocks on purpose: the existence check and its notFound() sit above Suspense
// in RacePageShell, because below a boundary they bake the 404 into the prerendered
// shell. Without this, next dev flags the awaited params as non-instant.
export const instant = false;

export const generateMetadata = ({ params }: { params: Promise<{ slug: string }> }) =>
  raceMetadata(params, (name, season) => ({
    title: name,
    description: `Lap-by-lap replay of the ${season} ${name}.`,
  }));

export default async function RacePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <RacePageShell params={params} view="replay">
      <ReplayPanel slug={slug} />
    </RacePageShell>
  );
}
