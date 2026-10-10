import { cacheLife, cacheTag } from 'next/cache';
import { executeQuery } from '@/graphql/execute';
import {
  ActiveSeasonDocument,
  ArchiveIndexDocument,
  CircuitProfileDocument,
  DriverProfileDocument,
  HeadToHeadDocument,
  HeroReplayDocument,
  HomeLineupDocument,
  LatestResultDocument,
  RaceAnalysisDocument,
  RaceHeaderDocument,
  RaceLibraryDocument,
  RacePredictionsDocument,
  RaceReplayDocument,
  RaceSlugsDocument,
  SeasonPulseDocument,
  SeasonScheduleDocument,
  SeasonStandingsDocument,
  TeamProfileDocument,
} from '@/graphql/generated/graphql';

/**
 * The cached read path.
 *
 * Every function here is a `use cache` scope, which means two things worth
 * stating plainly. Its arguments become the cache key, so a filtered library
 * and an unfiltered one are separate entries. And it cannot touch `cookies()`,
 * `headers()` or `searchParams` — the restriction follows the call stack, so a
 * page reads those itself and passes the values down as arguments.
 *
 * One `race` tag, not a tag per race. These reads used to carry `race:${slug}`
 * as well, with a comment saying a single re-import should not evict the
 * season — and nothing ever invalidated it, so it was a targeting ability no
 * caller could use.
 *
 * Reinstating it would mean splitting the taxonomy: per-race pages under a
 * narrow tag, the library and the home page under a broad one, and every write
 * choosing correctly between them. The failure mode of choosing wrong is a page
 * that should have been dropped and was not — stale data, which is worse than
 * the cost this saves. An ingest imports one race a week; rebuilding the race
 * pages on demand after it is cheap.
 *
 * Tags are what the ingest job will invalidate. `cacheLife('days')` is the
 * safety net underneath: races change weekly, so a day is short enough that
 * nothing goes stale for long even if a revalidation is missed, and long
 * enough that ordinary traffic never wakes the database.
 */

/**
 * The win prediction panel's data, asked for only by a race that has not run.
 * Tagged `race` so an import's /api/revalidate refreshes it, and `settings` so
 * the admin's panel sizes do.
 */
export async function getRacePredictions(slug: string) {
  'use cache';
  cacheTag('race', 'settings');
  cacheLife('days');

  return executeQuery(RacePredictionsDocument, { slug });
}

export async function getDriverStandings(season: number) {
  'use cache';
  cacheTag('standings');
  cacheLife('days');

  return executeQuery(HomeLineupDocument, { season });
}

/**
 * Both championship tables for one season, plus the seasons the selector needs.
 * One scope rather than two: the page shows both, so splitting them would buy a
 * second cache entry and a second round trip for no page that wants half.
 */
export async function getSeasonStandings(season: number) {
  'use cache';
  cacheTag('standings');
  cacheLife('days');

  return executeQuery(SeasonStandingsDocument, { season });
}

export async function getRaceLibrary(
  season: number | null,
  search: string | null,
  after: string | null,
  before: string | null = null,
) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(RaceLibraryDocument, {
    season,
    search,
    // A season is at most 31 scored sessions, so asking for 40 puts a whole one
    // on a single page and the pagination controls never appear for the view
    // almost everyone is looking at. Only "all seasons" pages.
    first: season === null ? 24 : 40,
    after,
    before,
  });
}

export async function getRaceHeader(slug: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(RaceHeaderDocument, { slug });
}

/**
 * The replay payload: every lap of every driver, which is the one query in the
 * application large enough to matter. It is a separate scope from the header so
 * the classification is not held behind it, and so the two can be invalidated
 * together but fetched apart.
 */
export async function getRaceReplay(slug: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(RaceReplayDocument, { slug });
}

/**
 * The Analysis tab. A third scope beside the header and the replay, for the same
 * reason those two are separate: a visitor who never opens the tab never pays
 * for it, and the tab does not wait on the replay's payload to render.
 */
export async function getRaceAnalysis(slug: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(RaceAnalysisDocument, { slug });
}

// ── The archive ───────────────────────────────────────────────────────
//
// Tagged `race` like everything else: a career total is an aggregate over race
// results, so the thing that invalidates it is an ingest, and there is no
// second tag that would be more precise.

export async function getDriverProfile(code: string) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  return executeQuery(DriverProfileDocument, { code });
}

export async function getTeamProfile(name: string) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  return executeQuery(TeamProfileDocument, { name });
}

/**
 * Which season the site is about, from `app_config` rather than a constant.
 *
 * Tagged `settings` as well as `race`: changing the season in the admin has to
 * drop this, or the home page keeps last season for a day. `updateConfigAction`
 * revalidates that tag.
 */
export async function getActiveSeason(): Promise<number> {
  'use cache';
  cacheTag('race', 'settings');
  cacheLife('days');

  const { activeSeason } = await executeQuery(ActiveSeasonDocument);
  return activeSeason;
}

/**
 * Every race of a season, for the home page's progress and countdown.
 *
 * `first: 100` rather than the library's 24: a season is at most 24 grands
 * prix plus six sprints, and a page boundary here would silently under-count
 * the season rather than showing a "next page" the caller could follow.
 */
export async function getSeasonSchedule(season: number) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(SeasonScheduleDocument, { season });
}

/**
 * Two drivers inside one race.
 *
 * Its own scope rather than part of `getRaceAnalysis`: the pair keys the cache
 * entry, and the rest of that payload — every lap time of every driver — does
 * not vary by it. Sharing one entry would mean re-fetching all of it for each
 * comparison someone tries.
 */
export async function getHeadToHead(slug: string, driverA: string, driverB: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(HeadToHeadDocument, { slug, driverA, driverB });
}

/**
 * Everyone and everything in the archive, optionally narrowed to one season.
 *
 * The argument keys the cache entry, so the unfiltered call that
 * `generateStaticParams` and the sitemap depend on is a separate entry from
 * whatever a visitor is browsing — and those two must stay unfiltered, since a
 * page that exists only in 2019 still needs to be built.
 */
export async function getArchiveIndex(season: number | null = null) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(ArchiveIndexDocument, { season, all: season === null });
}

export async function getCircuitProfile(ergastId: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(CircuitProfileDocument, { ergastId });
}

/**
 * The race the hero draws, with the slimmest projection that can draw it.
 *
 * This used to fetch a hundred races and take the last by date, which the
 * stored calendar turned into a race in December that nobody has driven — and
 * which was already arbitrary once the archive passed a hundred rows. The pick
 * is `Query.featuredRace` now: the admin's flag, else the newest race run.
 */
export async function getFeaturedRace() {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  const { featuredRace } = await executeQuery(HeroReplayDocument);
  return featuredRace;
}

export async function getLatestResult() {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  const { latestRace } = await executeQuery(LatestResultDocument);
  return latestRace;
}

export async function getSeasonPulse(season: number) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  const { seasonPulse } = await executeQuery(SeasonPulseDocument, { season });
  return seasonPulse;
}

export async function getRaceSlugs() {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery(RaceSlugsDocument);
}
