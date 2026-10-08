import type { driverStatus } from '@/db/schema';
import type {
  Driver, Lap, Meeting, Pit, PositionSample, RaceControl, Session, SessionResult, Stint, Weather,
} from './openf1';

/** Everything one scored session needs, already fetched and validated. */
export type RaceBundle = {
  meeting: Meeting;
  session: Session;
  /** Derived from the season's calendar — OpenF1 does not publish it. */
  round: number;
  drivers: Driver[];
  laps: Lap[];
  positions: PositionSample[];
  pits: Pit[];
  stints: Stint[];
  raceControl: RaceControl[];
  results: SessionResult[];
  weather: Weather[];
};

/**
 * Rows are keyed by driver_number rather than assignmentId throughout.
 *
 * The transform cannot know an assignment's uuid — the database hands those
 * out. Keeping the upstream key here is what lets the transform stay pure;
 * run.ts upserts the lineup, gets the uuids back, and resolves the reference
 * on the way to the write.
 */
export type LineupRow = {
  driverNumber: number;
  code: string;
  name: string;
  country: string | null;
  headshotUrl: string | null;
  teamName: string;
  teamColor: string | null;
  /**
   * Ergast's stable keys, set only by the archive import. OpenF1 does not
   * publish them, so they stay null on anything it writes and the existing
   * upsert keeps matching on code and team name.
   */
  ergastDriverId?: string | null;
  ergastConstructorId?: string | null;
};

export type PositionRow = {
  driverNumber: number;
  lap: number;
  position: number;
  gap: string | null;
  lapTime: number | null;
  sector1: number | null;
  sector2: number | null;
  sector3: number | null;
};

export type EventRow = {
  lap: number;
  /** null means the event belongs to the race, not to a driver. */
  driverNumber: number | null;
  type:
    | 'OVERTAKE' | 'PIT_STOP' | 'RETIREMENT' | 'SAFETY_CAR'
    | 'VIRTUAL_SAFETY_CAR' | 'RED_FLAG' | 'FASTEST_LAP' | 'PENALTY' | 'OTHER';
  details: string;
};

export type StintRow = {
  driverNumber: number;
  stintNumber: number;
  lapStart: number;
  lapEnd: number;
  compound: string | null;
  tyreAgeAtStart: number | null;
};

export type PitStopRow = {
  driverNumber: number;
  lap: number;
  /** Milliseconds, so the column is an integer; upstream publishes seconds. */
  durationMs: number | null;
};

export type ResultRow = {
  driverNumber: number;
  /**
   * Where the car started. Only the archive import can fill this — OpenF1
   * publishes no starting grid — so it is optional rather than nullable, and
   * an OpenF1 re-import of a race that has one must not blank it.
   */
  gridPosition?: number | null;
  finalPosition: number | null;
  status: (typeof driverStatus.enumValues)[number];
  lapsCompleted: number;
  points: number;
  fastestLap: boolean;
};

export type TransformedRace = {
  meeting: {
    seasonYear: number;
    round: number;
    name: string;
    country: string;
    circuitName: string | null;
    startDate: Date;
    weather: unknown;
    /** Null for an archive meeting: OpenF1 never saw it. */
    openf1MeetingKey: number | null;
    /** The circuit as a place, from Ergast. Null for an OpenF1-only import. */
    circuit?: {
      ergastCircuitId: string;
      name: string;
      locality: string | null;
      country: string | null;
      latitude: number | null;
      longitude: number | null;
    } | null;
  };
  race: {
    type: 'GRAND_PRIX' | 'SPRINT';
    slug: string;
    date: Date;
    laps: number;
    openf1SessionKey: number | null;
    /** What this era published. Defaults to FULL, which is the OpenF1 path. */
    dataTier?: 'FULL' | 'LAPS';
    /** How Ergast addresses this race, and how a re-import finds it again. */
    ergastRound?: number | null;
  };
  lineup: LineupRow[];
  positions: PositionRow[];
  events: EventRow[];
  results: ResultRow[];
  stints: StintRow[];
  pitStops: PitStopRow[];
  /**
   * Things that were survivable but not right — a driver with no position
   * samples at all, for instance. Surfaced rather than swallowed, because a
   * quietly incomplete import is worse than a loud failure.
   */
  warnings: string[];
};
