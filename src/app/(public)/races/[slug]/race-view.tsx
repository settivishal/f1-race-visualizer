import { Suspense, type ReactNode } from 'react';
import { PredictionPanel } from '@/components/schedule/prediction-panel';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Classification } from '@/components/race/classification';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { sessionTitle } from '@/lib/session-title';
import { Tabs } from '@/components/ui/tabs';
import { UpcomingRace } from '@/components/schedule/upcoming-race';
import { CircuitInfoPanel } from '@/components/replay/circuit-info-panel';
import { adjacentGrandsPrix, raceHeaderFact, seasonRoundLabel } from '@/lib/schedule';
import { ReplayAtLap } from '@/components/replay/replay-at-lap';
import { toReplayView } from '@/components/replay/types';
import { getRaceHeader, getRaceReplay, getRaceSlugs } from '@/lib/queries';
import { prerenderParams } from '@/lib/prerender';

/**
 * What the replay and analysis routes share: the header, the tabs, the
 * classification, and the rules for which races get prerendered.
 *
 * Nothing here reads the query string. That is the point of the split: a race
 * page depends on its slug alone, so it is prerendered once — replay payload
 * included — and served from the static cache, instead of re-running the
 * replay query per visit. On serverless hosting the in-memory `use cache` does
 * not outlive a request, so a runtime read was a database read. What still
 * depends on the URL (`?lap=`, the head-to-head pair) is read in the browser or
 * inside its own small Suspense boundary.
 */

export type View = 'replay' | 'analysis';

/**
 * The newest races are prerendered at build; older ones render on their first
 * visit and are cached from then on. Every prerendered race is a replay and an
 * analysis read per production deploy, and a merge is a deploy — so a season's
 * worth, not the archive.
 */
const PRODUCTION_PRERENDERED_RACES = 30;

export async function raceStaticParams() {
  const { raceSlugs } = await getRaceSlugs();
  return prerenderParams(
    raceSlugs.map(({ slug }) => ({ slug })),
    PRODUCTION_PRERENDERED_RACES,
  );
}

/**
 * The race page, around whichever view's panel it is given.
 *
 * Whether the race exists is checked here, above the Suspense boundary: a bad
 * slug must not render most of a race page and swap in the 404 mid-stream, and
 * `notFound()` below a boundary bakes the 404 into the prerendered shell. It
 * costs a cache read rather than a round trip — `getRaceHeader` is a `use
 * cache` scope that `generateMetadata` already awaited for the same slug.
 *
 * The status code is still 200 with Next's `noindex` tag. Cache Components
 * streams a static shell for every dynamic route, so the response is committed
 * before this runs.
 */
export async function RacePageShell({
  params,
  view,
  children,
}: {
  params: Promise<{ slug: string }>;
  view: View;
  children: ReactNode;
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
        <RaceDetail slug={slug} view={view}>
          {children}
        </RaceDetail>
      </Suspense>
    </PageContainer>
  );
}

async function RaceDetail({ slug, view, children }: { slug: string; view: View; children: ReactNode }) {
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

  return (
    <>
      <div className="mt-5">
        <SectionHeader
          eyebrow={meeting ? seasonRoundLabel(meeting.season, meeting.round) : 'Season unknown'}
          // "British Sprint", not "British Grand Prix" with a pill beside it
          // saying otherwise.
          title={meeting ? sessionTitle(meeting.name, race.type) : race.slug}
          viewTransitionName={`race-title-${race.slug}`}
          description={
            <>
              {meeting?.circuitName ?? meeting?.country ?? '—'} ·{' '}
              <span className="tabular">{raceHeaderFact(race)}</span>
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

          {/* Its own boundary: the countdown and circuit must not wait on it,
              and on most races it renders nothing at all. */}
          {race.status === 'SCHEDULED' && race.type === 'GRAND_PRIX' ? (
            <Suspense fallback={null}>
              <div className="mt-8 empty:hidden">
                <PredictionPanel slug={race.slug} />
              </div>
            </Suspense>
          ) : null}

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
          active={view}
          tabs={[
            { id: 'replay', label: 'Replay', href: `/races/${slug}` },
            { id: 'analysis', label: 'Analysis', href: `/races/${slug}/analysis` },
          ]}
        />
      </div>

      {children}

      {view === 'replay' ? (
        <div className="mt-10">
          <CircuitInfoPanel
            circuit={meeting?.circuit ?? null}
            circuitName={meeting?.circuitName ?? null}
            country={meeting?.country ?? null}
            laps={race.laps}
          />
        </div>
      ) : null}

      <Classification
        results={race.results}
        caption={`Final classification for the ${
          meeting ? sessionTitle(meeting.name, race.type) : race.slug
        }`}
      />

      {race.type === 'GRAND_PRIX' ? (
        <Suspense fallback={null}>
          <div className="mt-10 empty:hidden">
            <PredictionPanel slug={race.slug} results={race.results} />
          </div>
        </Suspense>
      ) : null}
        </>
      )}

      {race.type === 'GRAND_PRIX' ? <RaceNeighbours slug={race.slug} /> : null}
    </>
  );
}

/**
 * The grands prix either side of this one, at the foot of the page: the way to
 * walk a season without going back to the library.
 */
async function RaceNeighbours({ slug }: { slug: string }) {
  const { raceSlugs } = await getRaceSlugs();
  const { previous, next } = adjacentGrandsPrix(raceSlugs, slug);
  if (!previous && !next) return null;

  const link = (race: NonNullable<typeof previous>, direction: 'previous' | 'next') => (
    <Link
      href={`/races/${race.slug}`}
      className={`tap group flex flex-col gap-1.5 py-2 ${direction === 'next' ? 'items-end text-right' : ''}`}
    >
      <span className="flex items-center gap-3 text-eyebrow font-semibold uppercase tracking-[0.3em] text-muted group-hover:text-foreground">
        {direction === 'previous' ? (
          <span aria-hidden className="h-px w-10 bg-current transition-[width] group-hover:w-14" />
        ) : null}
        {direction === 'previous' ? 'Prev' : 'Next'}
        {direction === 'next' ? (
          <span aria-hidden className="h-px w-10 bg-current transition-[width] group-hover:w-14" />
        ) : null}
      </span>
      <span className="font-heading text-base font-bold tracking-tight">
        {race.date.slice(0, 4)} {race.name}
      </span>
    </Link>
  );

  return (
    <nav aria-label="Other races" className="mt-14 grid grid-cols-2 gap-4 border-t border-line pt-6">
      <div>{previous ? link(previous, 'previous') : null}</div>
      <div>{next ? link(next, 'next') : null}</div>
    </nav>
  );
}

/**
 * The replay tab's panel.
 *
 * One boundary covers both reasons it can suspend: the payload while it loads,
 * and `ReplayAtLap` reading `?lap=` — which is request data, so at build the
 * skeleton goes into the HTML while the payload still goes into the prerendered
 * RSC data. Either way no visit reads the database.
 */
export function ReplayPanel({ slug }: { slug: string }) {
  return (
    <div className="mt-8">
      <Suspense fallback={<ReplaySkeleton />}>
        <Replay slug={slug} />
      </Suspense>
    </div>
  );
}

/**
 * toReplayView narrows the payload once here: it drops entries whose driver row
 * is missing, and fills a team colour where there is none. Both are conditions
 * the schema is honest about and the renderer has nothing to draw for.
 */
async function Replay({ slug }: { slug: string }) {
  const { race } = await getRaceReplay(slug);
  if (!race) return null;

  return <ReplayAtLap visualization={toReplayView(race)} />;
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
export function AnalysisSkeleton() {
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
