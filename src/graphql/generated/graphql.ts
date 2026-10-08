/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type DataTier =
  | 'FULL'
  | 'LAPS';

export type DriverStatus =
  | 'DNF'
  | 'DNS'
  | 'DSQ'
  | 'FINISHED';

export type IngestRunStatus =
  | 'FAILED'
  | 'RUNNING'
  | 'SUCCESS';

export type PulseRoundStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'SCHEDULED';

export type RaceStatus =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'SCHEDULED';

export type RaceType =
  | 'GRAND_PRIX'
  | 'SPRINT';

export type SearchKind =
  | 'CIRCUIT'
  | 'DRIVER'
  | 'RACE'
  | 'TEAM';

export type AdminRacesQueryVariables = Exact<{
  season?: number | null | undefined;
  search?: string | null | undefined;
  first?: number | null | undefined;
  after?: string | null | undefined;
}>;


export type AdminRacesQuery = { races: { edges: Array<{ cursor: string, node: { id: string, slug: string, laps: number, type: RaceType, isFeatured: boolean, openf1SessionKey: number | null, meeting: { name: string, country: string, circuitName: string | null, round: number, season: number } | null } }>, pageInfo: { hasNextPage: boolean, endCursor: string | null } }, seasons: Array<{ year: number }> };

export type AdminRaceQueryVariables = Exact<{
  slug: string;
}>;


export type AdminRaceQuery = { race: { id: string, slug: string, laps: number, type: RaceType, status: RaceStatus, isFeatured: boolean, adminEdited: Array<string>, openf1SessionKey: number | null, meeting: { name: string, country: string, circuitName: string | null, round: number, season: number, adminEdited: Array<string> } | null } | null };

export type AdminIngestRunsQueryVariables = Exact<{
  first?: number | null | undefined;
}>;


export type AdminIngestRunsQuery = { ingestRuns: Array<{ id: string, source: string, target: string | null, status: IngestRunStatus, rowsWritten: number, error: string | null, startedAt: string, finishedAt: string | null }> };

export type SetRaceFeaturedMutationVariables = Exact<{
  slug: string;
  featured: boolean;
}>;


export type SetRaceFeaturedMutation = { setRaceFeatured: { slug: string, isFeatured: boolean } };

export type UpdateRaceMetadataMutationVariables = Exact<{
  slug: string;
  laps?: number | null | undefined;
  name?: string | null | undefined;
  country?: string | null | undefined;
  circuitName?: string | null | undefined;
  status?: string | null | undefined;
  release?: Array<string> | string | null | undefined;
}>;


export type UpdateRaceMetadataMutation = { updateRaceMetadata: { slug: string, laps: number, meeting: { name: string, country: string, circuitName: string | null } | null } };

export type TriggerIngestMutationVariables = Exact<{
  sessionKey: number;
}>;


export type TriggerIngestMutation = { triggerIngest: { slug: string, rowsWritten: number, warnings: Array<string> } };

export type RaceAnalysisQueryVariables = Exact<{
  slug: string;
}>;


export type RaceAnalysisQuery = { race: { id: string, slug: string, laps: number, dataTier: DataTier, meeting: { name: string, season: number } | null, analysis: { lapTimes: Array<{ driver: { id: string, code: string, name: string } | null, team: { id: string, name: string, color: string | null } | null, laps: Array<{ lap: number, time: number, isOutlier: boolean }>, pace: { best: number | null, median: number | null, consistency: number | null, lapsCounted: number, lapsExcluded: number } }>, stints: Array<{ stintNumber: number, lapStart: number, lapEnd: number, compound: string | null, driver: { id: string, code: string } | null, team: { color: string | null } | null }>, pitStops: Array<{ lap: number, durationSeconds: number | null, underStoppage: boolean, driver: { id: string, code: string } | null }> } } | null };

export type HeadToHeadQueryVariables = Exact<{
  slug: string;
  driverA: string;
  driverB: string;
}>;


export type HeadToHeadQuery = { race: { slug: string, laps: number, meeting: { name: string, season: number } | null, results: Array<{ finalPosition: number | null, driver: { code: string, name: string } | null }>, analysis: { headToHead: { lapsAheadA: number, lapsAheadB: number, a: { finalPosition: number | null, driver: { code: string, name: string } | null, team: { name: string, color: string | null } | null, pace: { best: number | null, median: number | null, consistency: number | null, lapsCounted: number } }, b: { finalPosition: number | null, driver: { code: string, name: string } | null, team: { name: string, color: string | null } | null, pace: { best: number | null, median: number | null, consistency: number | null, lapsCounted: number } }, laps: Array<{ lap: number, positionDelta: number | null, timeDelta: number | null }> } | null } } | null };

export type DriverProfileQueryVariables = Exact<{
  code: string;
}>;


export type DriverProfileQuery = { driver: { driver: { id: string, code: string, name: string, number: number | null, country: string | null }, career: { seasonCount: number, starts: number, wins: number, podiums: number, points: number, bestFinish: number | null, seasons: Array<{ season: number, starts: number, wins: number, podiums: number, points: number, bestFinish: number | null, team: { name: string, color: string | null } | null }> } } | null };

export type TeamProfileQueryVariables = Exact<{
  name: string;
}>;


export type TeamProfileQuery = { team: { team: { id: string, name: string, color: string | null }, drivers: Array<{ code: string, name: string }>, career: { seasonCount: number, starts: number, wins: number, podiums: number, points: number, bestFinish: number | null, seasons: Array<{ season: number, starts: number, wins: number, podiums: number, points: number, bestFinish: number | null }> } } | null };

export type ArchiveIndexQueryVariables = Exact<{
  season?: number | null | undefined;
}>;


export type ArchiveIndexQuery = { seasons: Array<{ year: number }>, drivers: Array<{ id: string, code: string, name: string, country: string | null }>, teams: Array<{ id: string, name: string, color: string | null }>, circuits: Array<{ id: string, ergastId: string, name: string, locality: string | null, country: string | null }> };

export type CircuitProfileQueryVariables = Exact<{
  ergastId: string;
}>;


export type CircuitProfileQuery = { circuit: { id: string, ergastId: string, name: string, locality: string | null, country: string | null, latitude: number | null, longitude: number | null, lengthKm: number | null, turns: number | null, firstGrandPrix: number | null } | null };

export type HomeLineupQueryVariables = Exact<{
  season: number;
}>;


export type HomeLineupQuery = { driverStandings: Array<{ position: number, points: number, driver: { code: string, name: string, number: number | null }, team: { name: string, color: string | null } }> };

export type SeasonScheduleQueryVariables = Exact<{
  season: number;
}>;


export type SeasonScheduleQuery = { races: { edges: Array<{ node: { slug: string, date: string, type: RaceType, status: RaceStatus, meeting: { name: string, round: number | null } | null } }> } };

export type ActiveSeasonQueryVariables = Exact<{ [key: string]: never; }>;


export type ActiveSeasonQuery = { activeSeason: number };

export type HeroReplayQueryVariables = Exact<{ [key: string]: never; }>;


export type HeroReplayQuery = { featuredRace: { slug: string, laps: number, meeting: { name: string, season: number, circuitName: string | null, round: number | null } | null, replay: { summary: { maxLap: number, maxPosition: number }, drivers: Array<{ driver: { code: string } | null, team: { color: string | null } | null, positions: Array<{ lap: number, position: number }> }> } } | null };

export type LatestResultQueryVariables = Exact<{ [key: string]: never; }>;


export type LatestResultQuery = { latestRace: { slug: string, date: string, type: RaceType, meeting: { name: string, season: number, circuitName: string | null, country: string, round: number | null } | null, results: Array<{ finalPosition: number | null, fastestLap: boolean, points: number, status: DriverStatus, driver: { code: string, name: string } | null, team: { name: string, color: string | null } | null }> } | null };

export type SeasonPulseQueryVariables = Exact<{
  season: number;
}>;


export type SeasonPulseQuery = { seasonPulse: Array<{ round: number | null, name: string, slug: string | null, status: PulseRoundStatus, winnerCode: string | null, teamName: string | null, teamColor: string | null }> };

export type RaceLibraryQueryVariables = Exact<{
  season?: number | null | undefined;
  search?: string | null | undefined;
  first?: number | null | undefined;
  after?: string | null | undefined;
  before?: string | null | undefined;
}>;


export type RaceLibraryQuery = { races: { edges: Array<{ cursor: string, node: { id: string, slug: string, date: string, laps: number, status: RaceStatus, type: RaceType, isFeatured: boolean, meeting: { name: string, country: string, circuitName: string | null, season: number, round: number | null } | null, podium: Array<{ position: number, code: string, teamColor: string | null }>, weekendSprint: { slug: string, status: RaceStatus, podium: Array<{ position: number, code: string, teamColor: string | null }> } | null } }>, pageInfo: { hasNextPage: boolean, hasPreviousPage: boolean, startCursor: string | null, endCursor: string | null } }, seasons: Array<{ year: number }>, latestRace: { slug: string } | null, nextRace: { slug: string } | null };

export type RaceHeaderQueryVariables = Exact<{
  slug: string;
}>;


export type RaceHeaderQuery = { race: { id: string, slug: string, date: string, laps: number, status: RaceStatus, type: RaceType, meeting: { name: string, country: string, circuitName: string | null, season: number, round: number | null, circuit: { ergastId: string, name: string, locality: string | null, country: string | null, lengthKm: number | null, turns: number | null, firstGrandPrix: number | null } | null, races: Array<{ slug: string, type: RaceType, status: RaceStatus }> } | null, results: Array<{ gridPosition: number | null, finalPosition: number | null, lapsCompleted: number, points: number, status: DriverStatus, fastestLap: boolean, driver: { code: string, name: string, number: number | null } | null, team: { name: string, color: string | null } | null }> } | null };

export type RaceSlugsQueryVariables = Exact<{ [key: string]: never; }>;


export type RaceSlugsQuery = { raceSlugs: Array<{ slug: string, date: string, type: RaceType, name: string }> };

export type RacePredictionsQueryVariables = Exact<{
  slug: string;
}>;


export type RacePredictionsQuery = { race: { predictions: Array<{ winProbability: number, modelVersion: string, generatedAt: string, driver: { code: string, name: string } | null, team: { color: string | null } | null }> } | null, predictionDisplay: { shown: number, expanded: number } };

export type RaceReplayFieldsFragment = { laps: Array<number>, summary: { lapCount: number, maxLap: number, maxPosition: number, driverCount: number }, drivers: Array<{ driver: { id: string, code: string, name: string, number: number | null } | null, team: { id: string, name: string, color: string | null } | null, positions: Array<{ lap: number, position: number, lapTime: number | null, sector1: number | null, sector2: number | null, sector3: number | null }> }>, events: Array<{ lap: number, type: string, details: string, driver: { id: string, code: string, name: string, number: number | null } | null }> };

export type RaceReplayQueryVariables = Exact<{
  slug: string;
}>;


export type RaceReplayQuery = { race: { id: string, slug: string, laps: number, date: string, type: RaceType, dataTier: DataTier, meeting: { name: string, country: string, circuitName: string | null, season: number, round: number | null } | null, replay: { laps: Array<number>, summary: { lapCount: number, maxLap: number, maxPosition: number, driverCount: number }, drivers: Array<{ driver: { id: string, code: string, name: string, number: number | null } | null, team: { id: string, name: string, color: string | null } | null, positions: Array<{ lap: number, position: number, lapTime: number | null, sector1: number | null, sector2: number | null, sector3: number | null }> }>, events: Array<{ lap: number, type: string, details: string, driver: { id: string, code: string, name: string, number: number | null } | null }> } } | null };

export type CommandPaletteQueryVariables = Exact<{
  query: string;
}>;


export type CommandPaletteQuery = { search: Array<{ kind: SearchKind, title: string, subtitle: string | null, href: string }> };

export type SeasonStandingsQueryVariables = Exact<{
  season: number;
}>;


export type SeasonStandingsQuery = { driverStandings: Array<{ position: number, points: number, wins: number, podiums: number, driver: { code: string, name: string, number: number | null }, team: { name: string, color: string | null } }>, constructorStandings: Array<{ position: number, points: number, wins: number, team: { name: string, color: string | null } }>, seasons: Array<{ year: number }> };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const RaceReplayFieldsFragmentDoc = new TypedDocumentString(`
    fragment RaceReplayFields on RaceReplay {
  laps
  summary {
    lapCount
    maxLap
    maxPosition
    driverCount
  }
  drivers {
    driver {
      id
      code
      name
      number
    }
    team {
      id
      name
      color
    }
    positions {
      lap
      position
      lapTime
      sector1
      sector2
      sector3
    }
  }
  events {
    lap
    type
    details
    driver {
      id
      code
      name
      number
    }
  }
}
    `, {"fragmentName":"RaceReplayFields"}) as unknown as TypedDocumentString<RaceReplayFieldsFragment, unknown>;
export const AdminRacesDocument = new TypedDocumentString(`
    query AdminRaces($season: Int, $search: String, $first: Int, $after: String) {
  races(season: $season, search: $search, first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        slug
        laps
        type
        isFeatured
        openf1SessionKey
        meeting {
          name
          country
          circuitName
          round
          season
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  seasons {
    year
  }
}
    `) as unknown as TypedDocumentString<AdminRacesQuery, AdminRacesQueryVariables>;
export const AdminRaceDocument = new TypedDocumentString(`
    query AdminRace($slug: String!) {
  race(slug: $slug) {
    id
    slug
    laps
    type
    status
    isFeatured
    adminEdited
    openf1SessionKey
    meeting {
      name
      country
      circuitName
      round
      season
      adminEdited
    }
  }
}
    `) as unknown as TypedDocumentString<AdminRaceQuery, AdminRaceQueryVariables>;
export const AdminIngestRunsDocument = new TypedDocumentString(`
    query AdminIngestRuns($first: Int) {
  ingestRuns(first: $first) {
    id
    source
    target
    status
    rowsWritten
    error
    startedAt
    finishedAt
  }
}
    `) as unknown as TypedDocumentString<AdminIngestRunsQuery, AdminIngestRunsQueryVariables>;
export const SetRaceFeaturedDocument = new TypedDocumentString(`
    mutation SetRaceFeatured($slug: String!, $featured: Boolean!) {
  setRaceFeatured(slug: $slug, featured: $featured) {
    slug
    isFeatured
  }
}
    `) as unknown as TypedDocumentString<SetRaceFeaturedMutation, SetRaceFeaturedMutationVariables>;
export const UpdateRaceMetadataDocument = new TypedDocumentString(`
    mutation UpdateRaceMetadata($slug: String!, $laps: Int, $name: String, $country: String, $circuitName: String, $status: String, $release: [String!]) {
  updateRaceMetadata(
    slug: $slug
    laps: $laps
    name: $name
    country: $country
    circuitName: $circuitName
    status: $status
    release: $release
  ) {
    slug
    laps
    meeting {
      name
      country
      circuitName
    }
  }
}
    `) as unknown as TypedDocumentString<UpdateRaceMetadataMutation, UpdateRaceMetadataMutationVariables>;
export const TriggerIngestDocument = new TypedDocumentString(`
    mutation TriggerIngest($sessionKey: Int!) {
  triggerIngest(sessionKey: $sessionKey) {
    slug
    rowsWritten
    warnings
  }
}
    `) as unknown as TypedDocumentString<TriggerIngestMutation, TriggerIngestMutationVariables>;
export const RaceAnalysisDocument = new TypedDocumentString(`
    query RaceAnalysis($slug: String!) {
  race(slug: $slug) {
    id
    slug
    laps
    dataTier
    meeting {
      name
      season
    }
    analysis {
      lapTimes {
        driver {
          id
          code
          name
        }
        team {
          id
          name
          color
        }
        laps {
          lap
          time
          isOutlier
        }
        pace {
          best
          median
          consistency
          lapsCounted
          lapsExcluded
        }
      }
      stints {
        stintNumber
        lapStart
        lapEnd
        compound
        driver {
          id
          code
        }
        team {
          color
        }
      }
      pitStops {
        lap
        durationSeconds
        underStoppage
        driver {
          id
          code
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<RaceAnalysisQuery, RaceAnalysisQueryVariables>;
export const HeadToHeadDocument = new TypedDocumentString(`
    query HeadToHead($slug: String!, $driverA: String!, $driverB: String!) {
  race(slug: $slug) {
    slug
    laps
    meeting {
      name
      season
    }
    results {
      finalPosition
      driver {
        code
        name
      }
    }
    analysis {
      headToHead(driverA: $driverA, driverB: $driverB) {
        lapsAheadA
        lapsAheadB
        a {
          driver {
            code
            name
          }
          team {
            name
            color
          }
          finalPosition
          pace {
            best
            median
            consistency
            lapsCounted
          }
        }
        b {
          driver {
            code
            name
          }
          team {
            name
            color
          }
          finalPosition
          pace {
            best
            median
            consistency
            lapsCounted
          }
        }
        laps {
          lap
          positionDelta
          timeDelta
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<HeadToHeadQuery, HeadToHeadQueryVariables>;
export const DriverProfileDocument = new TypedDocumentString(`
    query DriverProfile($code: String!) {
  driver(code: $code) {
    driver {
      id
      code
      name
      number
      country
    }
    career {
      seasonCount
      starts
      wins
      podiums
      points
      bestFinish
      seasons {
        season
        starts
        wins
        podiums
        points
        bestFinish
        team {
          name
          color
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<DriverProfileQuery, DriverProfileQueryVariables>;
export const TeamProfileDocument = new TypedDocumentString(`
    query TeamProfile($name: String!) {
  team(name: $name) {
    team {
      id
      name
      color
    }
    drivers {
      code
      name
    }
    career {
      seasonCount
      starts
      wins
      podiums
      points
      bestFinish
      seasons {
        season
        starts
        wins
        podiums
        points
        bestFinish
      }
    }
  }
}
    `) as unknown as TypedDocumentString<TeamProfileQuery, TeamProfileQueryVariables>;
export const ArchiveIndexDocument = new TypedDocumentString(`
    query ArchiveIndex($season: Int) {
  seasons {
    year
  }
  drivers(season: $season) {
    id
    code
    name
    country
  }
  teams(season: $season) {
    id
    name
    color
  }
  circuits {
    id
    ergastId
    name
    locality
    country
  }
}
    `) as unknown as TypedDocumentString<ArchiveIndexQuery, ArchiveIndexQueryVariables>;
export const CircuitProfileDocument = new TypedDocumentString(`
    query CircuitProfile($ergastId: String!) {
  circuit(ergastId: $ergastId) {
    id
    ergastId
    name
    locality
    country
    latitude
    longitude
    lengthKm
    turns
    firstGrandPrix
  }
}
    `) as unknown as TypedDocumentString<CircuitProfileQuery, CircuitProfileQueryVariables>;
export const HomeLineupDocument = new TypedDocumentString(`
    query HomeLineup($season: Int!) {
  driverStandings(season: $season) {
    position
    points
    driver {
      code
      name
      number
    }
    team {
      name
      color
    }
  }
}
    `) as unknown as TypedDocumentString<HomeLineupQuery, HomeLineupQueryVariables>;
export const SeasonScheduleDocument = new TypedDocumentString(`
    query SeasonSchedule($season: Int!) {
  races(season: $season, first: 100) {
    edges {
      node {
        slug
        date
        type
        status
        meeting {
          name
          round: officialRound
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<SeasonScheduleQuery, SeasonScheduleQueryVariables>;
export const ActiveSeasonDocument = new TypedDocumentString(`
    query ActiveSeason {
  activeSeason
}
    `) as unknown as TypedDocumentString<ActiveSeasonQuery, ActiveSeasonQueryVariables>;
export const HeroReplayDocument = new TypedDocumentString(`
    query HeroReplay {
  featuredRace {
    slug
    laps
    meeting {
      name
      round: officialRound
      season
      circuitName
    }
    replay {
      summary {
        maxLap
        maxPosition
      }
      drivers {
        driver {
          code
        }
        team {
          color
        }
        positions {
          lap
          position
        }
      }
    }
  }
}
    `) as unknown as TypedDocumentString<HeroReplayQuery, HeroReplayQueryVariables>;
export const LatestResultDocument = new TypedDocumentString(`
    query LatestResult {
  latestRace {
    slug
    date
    type
    meeting {
      name
      round: officialRound
      season
      circuitName
      country
    }
    results {
      finalPosition
      fastestLap
      points
      status
      driver {
        code
        name
      }
      team {
        name
        color
      }
    }
  }
}
    `) as unknown as TypedDocumentString<LatestResultQuery, LatestResultQueryVariables>;
export const SeasonPulseDocument = new TypedDocumentString(`
    query SeasonPulse($season: Int!) {
  seasonPulse(season: $season) {
    round
    name
    slug
    status
    winnerCode
    teamName
    teamColor
  }
}
    `) as unknown as TypedDocumentString<SeasonPulseQuery, SeasonPulseQueryVariables>;
export const RaceLibraryDocument = new TypedDocumentString(`
    query RaceLibrary($season: Int, $search: String, $first: Int, $after: String, $before: String) {
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
        id
        slug
        date
        laps
        status
        type
        isFeatured
        meeting {
          name
          country
          circuitName
          round: officialRound
          season
        }
        podium {
          position
          code
          teamColor
        }
        weekendSprint {
          slug
          status
          podium {
            position
            code
            teamColor
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
  seasons {
    year
  }
  latestRace {
    slug
  }
  nextRace {
    slug
  }
}
    `) as unknown as TypedDocumentString<RaceLibraryQuery, RaceLibraryQueryVariables>;
export const RaceHeaderDocument = new TypedDocumentString(`
    query RaceHeader($slug: String!) {
  race(slug: $slug) {
    id
    slug
    date
    laps
    status
    type
    meeting {
      name
      country
      circuitName
      round: officialRound
      season
      circuit {
        ergastId
        name
        locality
        country
        lengthKm
        turns
        firstGrandPrix
      }
      races {
        slug
        type
        status
      }
    }
    results {
      gridPosition
      finalPosition
      lapsCompleted
      points
      status
      fastestLap
      driver {
        code
        name
        number
      }
      team {
        name
        color
      }
    }
  }
}
    `) as unknown as TypedDocumentString<RaceHeaderQuery, RaceHeaderQueryVariables>;
export const RaceSlugsDocument = new TypedDocumentString(`
    query RaceSlugs {
  raceSlugs {
    slug
    date
    type
    name
  }
}
    `) as unknown as TypedDocumentString<RaceSlugsQuery, RaceSlugsQueryVariables>;
export const RacePredictionsDocument = new TypedDocumentString(`
    query RacePredictions($slug: String!) {
  race(slug: $slug) {
    predictions {
      winProbability
      modelVersion
      generatedAt
      driver {
        code
        name
      }
      team {
        color
      }
    }
  }
  predictionDisplay {
    shown
    expanded
  }
}
    `) as unknown as TypedDocumentString<RacePredictionsQuery, RacePredictionsQueryVariables>;
export const RaceReplayDocument = new TypedDocumentString(`
    query RaceReplay($slug: String!) {
  race(slug: $slug) {
    id
    slug
    laps
    date
    type
    dataTier
    meeting {
      name
      country
      circuitName
      round: officialRound
      season
    }
    replay {
      ...RaceReplayFields
    }
  }
}
    fragment RaceReplayFields on RaceReplay {
  laps
  summary {
    lapCount
    maxLap
    maxPosition
    driverCount
  }
  drivers {
    driver {
      id
      code
      name
      number
    }
    team {
      id
      name
      color
    }
    positions {
      lap
      position
      lapTime
      sector1
      sector2
      sector3
    }
  }
  events {
    lap
    type
    details
    driver {
      id
      code
      name
      number
    }
  }
}`) as unknown as TypedDocumentString<RaceReplayQuery, RaceReplayQueryVariables>;
export const CommandPaletteDocument = new TypedDocumentString(`
    query CommandPalette($query: String!) {
  search(query: $query) {
    kind
    title
    subtitle
    href
  }
}
    `) as unknown as TypedDocumentString<CommandPaletteQuery, CommandPaletteQueryVariables>;
export const SeasonStandingsDocument = new TypedDocumentString(`
    query SeasonStandings($season: Int!) {
  driverStandings(season: $season) {
    position
    points
    wins
    podiums
    driver {
      code
      name
      number
    }
    team {
      name
      color
    }
  }
  constructorStandings(season: $season) {
    position
    points
    wins
    team {
      name
      color
    }
  }
  seasons {
    year
  }
}
    `) as unknown as TypedDocumentString<SeasonStandingsQuery, SeasonStandingsQueryVariables>;