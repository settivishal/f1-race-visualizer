import { Suspense } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { ChampionshipFight } from '@/components/home/championship-fight';
import { HeroReplay } from '@/components/home/hero-replay';
import { LatestResult } from '@/components/home/latest-result';
import { SeasonPulse } from '@/components/home/season-pulse';
import { SeasonStatus, type ScheduledRace } from '@/components/home/season-status';
import {
  getActiveSeason, getDriverStandings, getFeaturedRace, getLatestResult,
  getSeasonPulse, getSeasonSchedule,
} from '@/lib/queries';

// Reads through the schema, not around it. A server component could query
// Drizzle directly and be quicker to write, but then GraphQL would be a facade
// over one path rather than the data layer — and the resolvers, the loaders and
// the query budget would go unexercised by the page people actually load.

// The one public route that had no metadata of its own, so it inherited the
// root title verbatim. Given the template, the title here is the bare name
// rather than the name plus a suffix.
export const metadata = {
  title: {
    absolute: 'RaceLines — every position change, lap by lap',
  },
  description:
    'Replay any grand prix as an animated position chart: pit windows, safety cars, and the lap someone finally got past.',
};

export default function Home() {
  return (
    <>
      {/* The hero is a full-bleed band, so it sits outside the container and
          carries its own. The copy is passed into the chart rather than beside
          it: one band, the claim over the thing that demonstrates it.

          The fallback holds the band's height, because the copy is inside it —
          a shorter fallback would drop the headline to the top of the viewport
          and then push it down when the race arrives. */}
      <Suspense fallback={<Skeleton className="h-[32rem] w-full rounded-none" />}>
        <HeroChart />
      </Suspense>

      <PageContainer className="py-14">
      {/* Each section streams on its own, so a slow standings query cannot hold
          up the featured race or the hero above it. */}
      <Suspense fallback={<Skeleton className="h-44 w-full" />}>
        <SeasonProgress />
      </Suspense>

      <Suspense fallback={<FeaturedSkeleton />}>
        <LatestRace />
      </Suspense>

      <Suspense fallback={<Skeleton className="mt-14 h-24 w-full" />}>
        <Pulse />
      </Suspense>

      <Suspense fallback={<Skeleton className="mt-14 h-44 w-full" />}>
        <TitleRace />
      </Suspense>

      <Suspense fallback={<StandingsSkeleton />}>
        <Standings />
      </Suspense>
      </PageContainer>
    </>
  );
}

/**
 * Grands prix only. A sprint is a session inside a round, not a round of its
 * own, so counting it would make a 24-race season read as 30.
 *
 * Cancelled rounds are left out too, for the reason the season strip gives:
 * they are not still to come, so they are not in the denominator, and a date
 * that passed without a race is not a round "complete".
 */
async function SeasonProgress() {
  const season = await getActiveSeason();
  const { races } = await getSeasonSchedule(season);

  const scheduled: ScheduledRace[] = races.edges
    .filter((edge) => edge.node.type === 'GRAND_PRIX' && edge.node.status !== 'CANCELLED')
    .map((edge) => ({
      slug: edge.node.slug,
      date: edge.node.date,
      name: edge.node.meeting?.name ?? edge.node.slug,
      round: edge.node.meeting?.round ?? 0,
    }));

  return <SeasonStatus season={season} races={scheduled} />;
}

/**
 * The featured race, drawn small and scrubbable.
 *
 * Ten drivers rather than twenty: the hero is 220px tall and twenty lines in it
 * is a smear. The ten who finished best are the ones whose lines cross.
 */
async function HeroChart() {
  const race = await getFeaturedRace();
  if (!race || race.replay.drivers.length === 0) return null;

  const drivers = [...race.replay.drivers]
    .sort((a, b) => lastPosition(a.positions) - lastPosition(b.positions))
    .slice(0, 10)
    .filter((entry) => entry.driver !== null)
    .map((entry) => ({
      code: entry.driver!.code,
      color: entry.team?.color ?? null,
      positions: entry.positions,
    }));

  return (
    <HeroReplay
      slug={race.slug}
      title={`${race.meeting?.season ?? ''} ${race.meeting?.name ?? race.slug}`.trim()}
      drivers={drivers}
      maxLap={race.replay.summary.maxLap}
      maxPosition={race.replay.summary.maxPosition}
    >
      {/* Not the season: the season status below already names the year, and
          two places saying it is how they come to disagree. */}
      <p className="text-eyebrow font-bold uppercase text-on-track-accent">
        Formula 1, replayed
      </p>
      <h1 className="font-heading mt-3 max-w-2xl text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
        Every position change,
        <br />
        <span className="text-white/60">lap by lap.</span>
      </h1>
      <p className="mt-5 max-w-xl text-lg leading-8 text-white/70">
        A grand prix is a thousand small moves that only make sense together. Pick a race
        and watch the order rearrange itself — pit windows, safety cars, the lap someone
        finally got past.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/races">
          <Button size="lg" className="transition-transform hover:scale-[1.03]">
            Browse races
          </Button>
        </Link>
      </div>
    </HeroReplay>
  );
}

const lastPosition = (positions: { position: number }[]) =>
  positions.length === 0 ? Number.MAX_SAFE_INTEGER : positions[positions.length - 1].position;

async function LatestRace() {
  const race = await getLatestResult();
  if (!race) return null;

  const where = race.meeting?.circuitName ?? race.meeting?.country ?? null;

  return (
    <LatestResult
      slug={race.slug}
      title={race.meeting?.name ?? race.slug}
      subtitle={
        race.meeting
          ? `${race.meeting.season} · Round ${race.meeting.round}${where ? ` · ${where}` : ''}`
          : (where ?? '')
      }
      isSprint={race.type === 'SPRINT'}
      results={race.results}
    />
  );
}

async function Pulse() {
  const season = await getActiveSeason();
  return <SeasonPulse season={season} rounds={await getSeasonPulse(season)} />;
}

/**
 * The title race. `remaining` counts what is scheduled and not yet run, which
 * the stored calendar makes a fact rather than an estimate.
 */
async function TitleRace() {
  const season = await getActiveSeason();
  const [{ driverStandings }, { races }] = await Promise.all([
    getDriverStandings(season),
    getSeasonSchedule(season),
  ]);

  if (driverStandings.length === 0) return null;

  // Cancelled rounds are not "remaining": no points will be scored at a race
  // that is not going to happen.
  const notRun = races.edges.filter((edge) => edge.node.status === 'SCHEDULED');
  const remaining = {
    grandsPrix: notRun.filter((edge) => edge.node.type === 'GRAND_PRIX').length,
    sprints: notRun.filter((edge) => edge.node.type === 'SPRINT').length,
  };

  const contender = (standing: (typeof driverStandings)[number]) => ({
    code: standing.driver.code,
    name: standing.driver.name,
    points: standing.points,
    teamColor: standing.team?.color ?? null,
  });

  return (
    <ChampionshipFight
      season={season}
      leader={contender(driverStandings[0])}
      second={driverStandings[1] ? contender(driverStandings[1]) : null}
      remaining={remaining}
    />
  );
}

async function Standings() {
  const season = await getActiveSeason();
  const { driverStandings } = await getDriverStandings(season);

  if (driverStandings.length === 0) {
    return null;
  }

  return (
    <section className="reveal mt-14">
      <div className="flex items-end justify-between gap-4">
        <h2 className="type-section-title">
          Drivers&rsquo; championship
        </h2>
        <Link
          href="/standings"
          className="rounded-sm text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Full standings
        </Link>
      </div>

      <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <caption className="sr-only">
            {season} drivers&rsquo; championship standings
          </caption>
          <thead>
            <tr className="border-b border-line text-eyebrow uppercase text-muted">
              <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Pos</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Driver</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
              <th scope="col" className="py-3 pr-5 text-right font-semibold">Points</th>
            </tr>
          </thead>
          <tbody>
            {driverStandings.map((standing) => (
              <tr
                key={standing.driver.code}
                className="border-b border-line/60 last:border-0"
              >
                <td className="tabular py-2.5 pl-5 pr-3 text-muted">{standing.position}</td>
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: standing.team.color ?? 'var(--muted)' }}
                    />
                    <span className="font-mono text-xs font-medium text-muted">
                      {standing.driver.code}
                    </span>
                    <span className="font-medium">{standing.driver.name}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-muted">{standing.team.name}</td>
                <td className="tabular py-2.5 pr-5 text-right font-semibold">
                  {standing.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

/*
 * The fallbacks are sized to their content rather than to a spinner, so the
 * page does not resize when either section arrives.
 */
function FeaturedSkeleton() {
  return (
    <section className="mt-14">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-[11.5rem] w-full rounded-xl" />
    </section>
  );
}

function StandingsSkeleton() {
  return (
    <section className="mt-14">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-4 h-[28rem] w-full rounded-xl" />
    </section>
  );
}
