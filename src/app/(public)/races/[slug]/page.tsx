import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { sessionTitle } from '@/lib/session-title';
import { Tabs } from '@/components/ui/tabs';
import { UpcomingRace } from '@/components/schedule/upcoming-race';
import { CircuitInfoPanel } from '@/components/replay/circuit-info-panel';
import { AnalysisPanel } from './analysis-panel';
import { RaceVisualizationPlayer } from '@/components/replay/race-visualization-player';
import { toReplayView } from '@/components/replay/types';
import { getRaceHeader, getRaceReplay, getRaceSlugs } from '@/lib/queries';

/**
 * The race detail page.
 *
 * The replay is its own cached query and its own Suspense boundary. It is the
 * one payload in the application large enough to matter — every lap of every
 * driver — so the header and the classification render without waiting on it.
 */
export async function generateStaticParams() {
  const { raceSlugs } = await getRaceSlugs();
  return raceSlugs.map(({ slug }) => ({ slug }));
}

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

const STATUS_LABEL: Record<string, string> = {
  FINISHED: '',
  DNF: 'DNF',
  DNS: 'DNS',
  DSQ: 'DSQ',
};

const VIEWS = ['replay', 'analysis'] as const;
type View = (typeof VIEWS)[number];

const isView = (value: unknown): value is View =>
  typeof value === 'string' && (VIEWS as readonly string[]).includes(value);

/**
 * `params` is URL data, and reading it above every Suspense boundary makes the
 * whole route block on the navigation instead of streaming into a shell — which
 * is why everything keyed by the slug still renders below the boundary.
 *
 * The one exception is whether the race exists at all. That check used to live
 * in `RaceDetail`, below the boundary, where a bad slug rendered most of a race
 * page and then swapped in the 404 mid-stream. It is hoisted here and the page
 * is async again, so nothing of the race renders for a slug that does not
 * exist.
 *
 * The status code is unchanged: still 200 with Next's `noindex` tag. Cache
 * Components streams a static shell for every dynamic route, so the response is
 * committed before this function runs — a real 404 status would have to come
 * from `proxy.ts`, which today does no database access at all.
 *
 * It costs a cache read and not a round trip: `getRaceHeader` is a `use cache`
 * scope, and `generateMetadata` above already awaits the same call for the same
 * slug. Every slug that exists is prerendered anyway by
 * `generateStaticParams`, so the only request that pays for this is the one
 * that was going to 404.
 */
export default async function RacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; lap?: string; a?: string; b?: string }>;
}) {
  const { slug } = await params;
  const { race: exists } = await getRaceHeader(slug);

  if (!exists) notFound();

  return (
    <PageContainer>
      <Link
        href="/races"
        className="inline-flex rounded-sm text-eyebrow font-semibold uppercase text-muted transition-colors hover:text-foreground"
      >
        ← All races
      </Link>

      <Suspense fallback={<RaceSkeleton />}>
        <RaceDetail params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function RaceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; lap?: string; a?: string; b?: string }>;
}) {
  const { slug } = await params;
  // The view lives in the URL, so it survives a reload and can be linked to.
  // Anything unrecognised falls back to the replay rather than 404ing: a bad
  // query string is not a missing page.
  const { view, lap, a, b } = await searchParams;
  const active: View = isView(view) ? view : 'replay';
  const initialLap = Number(lap);
  const { race } = await getRaceHeader(slug);

  // The page above has already established that this race exists and returned
  // a 404 if it did not. This one is left in to narrow the type — and because a
  // component that assumes a caller checked is a component that breaks the day
  // it gets a second caller.
  if (!race) notFound();

  const meeting = race.meeting;
  // The weekend's other session. The library lists one card per weekend, so
  // this is how someone gets from a grand prix to its sprint and back without
  // going through the library again.
  const sibling = meeting?.races.find((session) => session.slug !== race.slug) ?? null;
  const classified = [...race.results].sort((a, b) => {
    // A DNF has no finishing position, so it sorts after everyone who has one
    // rather than to the front on a null.
    if (a.finalPosition === null) return b.finalPosition === null ? 0 : 1;
    if (b.finalPosition === null) return -1;
    return a.finalPosition - b.finalPosition;
  });

  return (
    <>
      <div className="mt-5">
        <SectionHeader
          eyebrow={meeting ? `${meeting.season} · Round ${meeting.round}` : 'Season unknown'}
          // "British Sprint", not "British Grand Prix" with a pill beside it
          // saying otherwise.
          title={meeting ? sessionTitle(meeting.name, race.type) : race.slug}
          viewTransitionName={`race-title-${race.slug}`}
          description={
            <>
              {meeting?.circuitName ?? meeting?.country ?? '—'} ·{' '}
              <span className="tabular">{race.laps}</span> laps
            </>
          }
          // The weekend, as two sessions you can switch between: this one, and
          // the one you are not on. Reads as a control rather than as a link in
          // a sentence, which is what it is — the two pages are peers.
          actions={
            sibling ? (
              <nav aria-label="Weekend sessions" className="flex items-center gap-1 rounded-lg border border-line bg-panel p-1">
                <span className="rounded-md bg-panel-strong px-3 py-1.5 text-sm font-semibold text-foreground">
                  {race.type === 'SPRINT' ? 'Sprint' : 'Grand prix'}
                </span>
                <Link
                  href={`/races/${sibling.slug}`}
                  className="tap inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold text-muted transition-colors hover:bg-panel-strong hover:text-foreground"
                >
                  {sibling.type === 'SPRINT' ? 'Sprint' : 'Grand prix'}
                  <span aria-hidden className="text-accent">→</span>
                </Link>
              </nav>
            ) : null
          }
        />
      </div>

      {/* Neither a scheduled race nor a cancelled one has anything to replay,
          so tabs, a replay and a classification would all be empty furniture. */}
      {race.status !== 'COMPLETED' ? (
        <>
          <div className="mt-8">
            <UpcomingRace
              date={race.date}
              name={meeting ? sessionTitle(meeting.name, race.type) : race.slug}
              cancelled={race.status === 'CANCELLED'}
            />
          </div>

          <div className="mt-10">
            <CircuitInfoPanel
              circuit={meeting?.circuit ?? null}
              circuitName={meeting?.circuitName ?? null}
              country={meeting?.country ?? null}
              laps={race.laps}
            />
          </div>
        </>
      ) : (
        <>
      <div className="mt-8">
        <Tabs
          active={active}
          tabs={[
            { id: 'replay', label: 'Replay', href: `/races/${slug}` },
            { id: 'analysis', label: 'Analysis', href: `/races/${slug}?view=analysis` },
          ]}
        />
      </div>

      {active === 'replay' ? (
        <>
          <div className="mt-8">
            <Suspense fallback={<ReplaySkeleton />}>
              <Replay slug={slug} initialLap={Number.isFinite(initialLap) && initialLap > 0 ? initialLap : undefined} />
            </Suspense>
          </div>

          <div className="mt-10">
            <CircuitInfoPanel
              circuit={meeting?.circuit ?? null}
              circuitName={meeting?.circuitName ?? null}
              country={meeting?.country ?? null}
              laps={race.laps}
            />
          </div>
        </>
      ) : (
        <div className="mt-8">
          <Suspense fallback={<AnalysisSkeleton />}>
            <AnalysisPanel slug={slug} driverA={a ?? null} driverB={b ?? null} />
          </Suspense>
        </div>
      )}

      <section className="mt-10">
        <h2 className="type-section-title">Classification</h2>
        <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">
            Final classification for the{' '}
            {meeting ? sessionTitle(meeting.name, race.type) : race.slug}
          </caption>
          <thead>
            <tr className="border-b border-line text-eyebrow uppercase text-muted">
              <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Pos</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Driver</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
              <th scope="col" className="py-3 pr-3 text-right font-semibold">Laps</th>
              <th scope="col" className="py-3 pr-5 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {classified.map((result, index) => (
              <tr
                key={result.driver?.code ?? `row-${index}`}
                className="border-b border-line/60 last:border-0"
              >
                <td className="tabular py-2.5 pl-5 pr-3 text-muted">
                  {result.finalPosition ?? STATUS_LABEL[result.status] ?? '—'}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: result.team?.color ?? 'var(--muted)' }}
                      aria-hidden
                    />
                    <span className="font-mono text-xs font-medium text-muted">
                      {result.driver?.code ?? '—'}
                    </span>
                    <span className="font-medium">{result.driver?.name ?? 'Unknown driver'}</span>
                    {result.fastestLap ? (
                      <span
                        className="text-eyebrow font-bold uppercase text-accent"
                        title="Fastest lap"
                      >
                        FL
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-muted">{result.team?.name ?? '—'}</td>
                <td className="tabular py-2.5 pr-3 text-right">{result.lapsCompleted}</td>
                <td className="tabular py-2.5 pr-5 text-right font-semibold">{result.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </Card>
      </section>
        </>
      )}
    </>
  );
}

/**
 * toReplayView narrows the payload once here: it drops entries whose driver row
 * is missing, and fills a team colour where there is none. Both are conditions
 * the schema is honest about and the renderer has nothing to draw for.
 */
async function Replay({ slug, initialLap }: { slug: string; initialLap?: number }) {
  const { race } = await getRaceReplay(slug);
  if (!race) return null;

  return <RaceVisualizationPlayer visualization={toReplayView(race)} initialLap={initialLap} />;
}

/** The shell's fallback: header, player and classification, in that order. */
function RaceSkeleton() {
  return (
    <div className="mt-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-12 w-96 max-w-full" />
      <Skeleton className="mt-3 h-5 w-64" />
      <div className="mt-10 space-y-4">
        <Skeleton className="h-[26rem] w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
      <Skeleton className="mt-10 h-[30rem] w-full rounded-xl" />
    </div>
  );
}

/** Sized to the charts, for the same reason the replay's fallback is. */
function AnalysisSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-[22rem] w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <p className="sr-only" role="status">
        Loading analysis
      </p>
    </div>
  );
}

/**
 * Sized to the player rather than to a spinner. The replay is the tallest thing
 * on the page, so a short fallback makes everything below it jump when the
 * payload lands.
 */
function ReplaySkeleton() {
  return (
    // The tower's rail and the canvas column, matching the player's own grid,
    // so the page does not jump sideways when the replay arrives.
    <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Skeleton className="h-[26rem] w-full rounded-xl lg:h-[38rem]" />
      <div className="space-y-3">
        <Skeleton className="h-[26rem] w-full rounded-xl lg:h-[30rem]" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
      <p className="sr-only" role="status">
        Loading replay
      </p>
    </div>
  );
}
