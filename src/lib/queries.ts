import { cacheLife, cacheTag } from 'next/cache';
import { executeQuery } from '@/graphql/execute';
import type {
  HomeLineupQuery,
  RaceReplayQuery,
  RaceHeaderQuery,
  RaceLibraryQuery,
  RaceSlugsQuery,
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
  query RaceLibrary($season: Int, $search: String, $first: Int, $after: String) {
    races(season: $season, search: $search, first: $first, after: $after) {
      edges {
        cursor
        node {
          id slug date laps type isFeatured
          meeting { name country circuitName round season }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
    seasons { year }
  }
`;

const RACE_HEADER = /* GraphQL */ `
  query RaceHeader($slug: String!) {
    race(slug: $slug) {
      id slug date laps type
      meeting { name country circuitName round season weather }
      results {
        finalPosition lapsCompleted points status fastestLap
        driver { code name number }
        team { name color }
      }
    }
  }
`;

const RACE_SLUGS = /* GraphQL */ `
  query RaceSlugs($first: Int) {
    races(first: $first) {
      edges { node { slug } }
    }
  }
`;

export async function getDriverStandings(season: number) {
  'use cache';
  cacheTag('standings');
  cacheLife('days');

  return executeQuery<HomeLineupQuery, { season: number }>(HOME_LINEUP, { season });
}

export async function getRaceLibrary(
  season: number | null,
  search: string | null,
  after: string | null,
) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery<RaceLibraryQuery, Record<string, unknown>>(RACE_LIBRARY, {
    season,
    search,
    first: 24,
    after,
  });
}

export async function getRaceHeader(slug: string) {
  'use cache';
  // Tagged twice: the broad tag so an ingest can invalidate every race at once,
  // and the narrow one so a single re-import does not evict the season.
  cacheTag('race', `race:${slug}`);
  cacheLife('days');

  return executeQuery<RaceHeaderQuery, { slug: string }>(RACE_HEADER, { slug });
}

const RACE_REPLAY = /* GraphQL */ `
  query RaceReplay($slug: String!) {
    race(slug: $slug) {
      id slug laps date type
      meeting { name country circuitName round season weather }
      replay {
        laps
        summary { lapCount maxLap maxPosition driverCount }
        drivers {
          driver { id code name number }
          team { id name color }
          positions { lap position gap lapTime sector1 sector2 sector3 }
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
  cacheTag('race', `race:${slug}`);
  cacheLife('days');

  return executeQuery<RaceReplayQuery, { slug: string }>(RACE_REPLAY, { slug });
}

export async function getRaceSlugs(first = 100) {
  'use cache';
  cacheTag('race');
  cacheLife('days');

  return executeQuery<RaceSlugsQuery, Record<string, unknown>>(RACE_SLUGS, { first });
}
