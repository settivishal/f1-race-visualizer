import { cacheLife, cacheTag } from 'next/cache';
import { executeQuery } from '@/graphql/execute';
import type {
  ArchiveIndexQuery,
  CircuitProfileQuery,
  DriverProfileQuery,
  HeadToHeadQuery,
  HeroReplayQuery,
  LatestResultQuery,
  SeasonPulseQuery,
  RaceAnalysisQuery,
  TeamProfileQuery,
  HomeLineupQuery,
  RaceReplayQuery,
  RaceHeaderQuery,
  RaceLibraryQuery,
  RaceSlugsQuery,
  ActiveSeasonQuery,
  SeasonScheduleQuery,
  SeasonStandingsQuery,
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

const HOME_LINEUP = /* GraphQL */ `
  query HomeLineup($season: Int!) {
    driverStandings(season: $season) {
      position
      points
      driver { code name number }
      team { name color }
    }
  }
`;

const RACE_LIBRARY = /* GraphQL */ `
  query RaceLibrary($season: Int, $search: String, $first: Int, $after: String, $before: String) {
    # Grands prix only: a sprint is a session inside the weekend, and it arrives
    # on its grand prix as \`weekendSprint\` rather than as a second card.
    races(
      season: $season
      search: $search
      type: GRAND_PRIX
      first: $first
      after: $after
      before: $before
    ) {
      edges {
        cursor
        node {
          id slug date laps status type isFeatured
          meeting { name country circuitName round season }
          podium { position code teamColor }
          weekendSprint {
            slug
            status
            podium { position code teamColor }
          }
        }
      }
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    }
    seasons { year }
    # Which tile is "upcoming" and which one glows. Asked globally rather than
    # derived from the page's own edges, so both stay right on page two of "all
    # seasons" and on a past season, where neither should match anything.
    latestRace { slug }
    nextRace { slug }
  }
`;

const RACE_HEADER = /* GraphQL */ `
  query RaceHeader($slug: String!) {
    race(slug: $slug) {
      id slug date laps status type
      meeting {
        name country circuitName round season
        circuit { ergastId name locality country lengthKm turns firstGrandPrix }
        # The weekend's other sessions, so a race page can point at its sibling
        # — the library shows one card per weekend, and without this the sprint
        # is reachable from the card and from nowhere else.
        races { slug type status }
      }
      results {
        finalPosition lapsCompleted points status fastestLap
        driver { code name number }
        team { name color }
      }
    }
  }
`;

/**
 * The race the landing page leads with.
 *
 * `Query.races` orders by date ascending and takes no `featured` argument, so
 * the pick happens here rather than in SQL: the first race flagged featured if
 * there is one, otherwise the most recent. Nothing is flagged yet — the
 * mutation that sets it is M3 — so today this resolves to the latest race and
 * starts honouring the flag the moment one exists, with no change here.
 *
 * Asking for 100 rows of four fields to choose one is cheap next to adding a
 * resolver argument, and the whole thing is one cached entry for a day.
 */
const HERO_REPLAY = /* GraphQL */ `
  query HeroReplay {
    featuredRace {
      slug
      laps
      meeting { name round season circuitName }
      replay {
        summary { maxLap maxPosition }
        drivers {
          driver { code }
          team { color }
          positions { lap position }
        }
      }
    }
  }
`;

const LATEST_RESULT = /* GraphQL */ `
  query LatestResult {
    latestRace {
      slug
      date
      type
      meeting { name round season circuitName country }
      results {
        finalPosition fastestLap points status
        driver { code name }
        team { name color }
      }
    }
  }
`;

const SEASON_PULSE = /* GraphQL */ `
  query SeasonPulse($season: Int!) {
    seasonPulse(season: $season) {
      round name slug status winnerCode teamName teamColor
    }
  }
`;

const RACE_SLUGS = /* GraphQL */ `
  query RaceSlugs {
    raceSlugs { slug date }
  }
`;

export async function getDriverStandings(season: number) {
  'use cache';
  cacheTag('standings');
  cacheLife('days');

  return executeQuery<HomeLineupQuery, { season: number }>(HOME_LINEUP, { season });
}

const SEASON_STANDINGS = /* GraphQL */ `
  query SeasonStandings($season: Int!) {
    driverStandings(season: $season) {
      position
      points
      wins
      podiums
      driver { code name number }
      team { name color }
    }
    constructorStandings(season: $season) {
      position
      points
      wins
      team { name color }
    }
    seasons { year }
  }
`;

/**
 * Both championship tables for one season, plus the seasons the selector needs.
 * One scope rather than two: the page shows both, so splitting them would buy a
 * second cache entry and a second round trip for no page that wants half.
 */
export async function getSeasonStandings(season: number) {
  'use cache';
  cacheTag('standings');
  cacheLife('days');

  return executeQuery<SeasonStandingsQuery, { season: number }>(SEASON_STANDINGS, { season });
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

  return executeQuery<RaceLibraryQuery, Record<string, unknown>>(RACE_LIBRARY, {
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

  return executeQuery<RaceHeaderQuery, { slug: string }>(RACE_HEADER, { slug });
}

const RACE_REPLAY = /* GraphQL */ `
  query RaceReplay($slug: String!) {
    race(slug: $slug) {
      id slug laps date type dataTier
      meeting { name country circuitName round season }
      replay {
        laps
        summary { lapCount maxLap maxPosition driverCount }
        drivers {
          driver { id code name number }
          team { id name color }
          positions { lap position lapTime sector1 sector2 sector3 }
        }
        events {
          lap type details
          driver { id code name number }
        }
      }
    }
  }
`;

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

  return executeQuery<RaceReplayQuery, { slug: string }>(RACE_REPLAY, { slug });
}

const RACE_ANALYSIS = /* GraphQL */ `
  query RaceAnalysis($slug: String!) {
    race(slug: $slug) {
      id slug laps dataTier
      meeting { name season }
      analysis {
        lapTimes {
          driver { id code name }
          team { id name color }
          laps { lap time isOutlier }
          pace { best median consistency lapsCounted lapsExcluded }
        }
        stints {
          stintNumber lapStart lapEnd compound
          driver { id code }
          team { color }
        }
        pitStops {
          lap durationSeconds underStoppage
          driver { id code }
        }
      }
    }
  }
`;

/**
 * The Analysis tab. A third scope beside the header and the replay, for the same
 * reason those two are separate: a visitor who never opens the tab never pays
 * for it, and the tab does not wait on the replay's payload to render.
 */
export async function getRaceAnalysis(slug: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery<RaceAnalysisQuery, { slug: string }>(RACE_ANALYSIS, { slug });
}

// ── The archive ───────────────────────────────────────────────────────
//
// Tagged `race` like everything else: a career total is an aggregate over race
// results, so the thing that invalidates it is an ingest, and there is no
// second tag that would be more precise.

const DRIVER_PROFILE = /* GraphQL */ `
  query DriverProfile($code: String!) {
    driver(code: $code) {
      driver { id code name number country }
      career {
        seasonCount starts wins podiums points bestFinish
        seasons {
          season starts wins podiums points bestFinish
          team { name color }
        }
      }
    }
  }
`;

export async function getDriverProfile(code: string) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  return executeQuery<DriverProfileQuery, { code: string }>(DRIVER_PROFILE, { code });
}

const TEAM_PROFILE = /* GraphQL */ `
  query TeamProfile($name: String!) {
    team(name: $name) {
      team { id name color }
      drivers { code name }
      career {
        seasonCount starts wins podiums points bestFinish
        seasons { season starts wins podiums points bestFinish }
      }
    }
  }
`;

export async function getTeamProfile(name: string) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  return executeQuery<TeamProfileQuery, { name: string }>(TEAM_PROFILE, { name });
}

const ACTIVE_SEASON = /* GraphQL */ `
  query ActiveSeason {
    activeSeason
  }
`;

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

  const { activeSeason } = await executeQuery<ActiveSeasonQuery, Record<string, unknown>>(
    ACTIVE_SEASON,
    {},
  );
  return activeSeason;
}

const SEASON_SCHEDULE = /* GraphQL */ `
  query SeasonSchedule($season: Int!) {
    races(season: $season, first: 100) {
      edges {
        node {
          slug
          date
          type
          status
          meeting { name round }
        }
      }
    }
  }
`;

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

  return executeQuery<SeasonScheduleQuery, { season: number }>(SEASON_SCHEDULE, { season });
}

const HEAD_TO_HEAD = /* GraphQL */ `
  query HeadToHead($slug: String!, $driverA: String!, $driverB: String!) {
    race(slug: $slug) {
      slug
      laps
      meeting { name season }
      results { finalPosition driver { code name } }
      analysis {
        headToHead(driverA: $driverA, driverB: $driverB) {
          lapsAheadA
          lapsAheadB
          a { driver { code name } team { name color } finalPosition pace { best median consistency lapsCounted } }
          b { driver { code name } team { name color } finalPosition pace { best median consistency lapsCounted } }
          laps { lap positionDelta timeDelta }
        }
      }
    }
  }
`;

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

  return executeQuery<HeadToHeadQuery, { slug: string; driverA: string; driverB: string }>(
    HEAD_TO_HEAD,
    { slug, driverA, driverB },
  );
}

const ARCHIVE_INDEX = /* GraphQL */ `
  query ArchiveIndex($season: Int) {
    seasons { year }
    drivers(season: $season) { id code name country }
    teams(season: $season) { id name color }
    circuits { id ergastId name locality country }
  }
`;

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

  return executeQuery<ArchiveIndexQuery, { season: number | null }>(ARCHIVE_INDEX, { season });
}

const CIRCUIT_PROFILE = /* GraphQL */ `
  query CircuitProfile($ergastId: String!) {
    circuit(ergastId: $ergastId) {
      id ergastId name locality country
      latitude longitude lengthKm turns firstGrandPrix
    }
  }
`;

export async function getCircuitProfile(ergastId: string) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery<CircuitProfileQuery, { ergastId: string }>(CIRCUIT_PROFILE, { ergastId });
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

  const { featuredRace } = await executeQuery<HeroReplayQuery, Record<string, unknown>>(
    HERO_REPLAY,
    {},
  );
  return featuredRace;
}

export async function getLatestResult() {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  const { latestRace } = await executeQuery<LatestResultQuery, Record<string, unknown>>(
    LATEST_RESULT,
    {},
  );
  return latestRace;
}

export async function getSeasonPulse(season: number) {
  'use cache';
  cacheTag('race', 'standings');
  cacheLife('days');

  const { seasonPulse } = await executeQuery<SeasonPulseQuery, { season: number }>(
    SEASON_PULSE,
    { season },
  );
  return seasonPulse;
}

export async function getRaceSlugs() {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery<RaceSlugsQuery, Record<string, unknown>>(RACE_SLUGS, {});
}
