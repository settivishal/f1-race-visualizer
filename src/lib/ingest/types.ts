import type {
  Driver, Lap, Meeting, Pit, PositionSample, RaceControl, Session, SessionResult, Weather,
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

export type ResultRow = {
  driverNumber: number;
  finalPosition: number | null;
  status: 'FINISHED' | 'DNF' | 'DNS' | 'DSQ';
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
    openf1MeetingKey: number;
  };
  race: {
    type: 'GRAND_PRIX' | 'SPRINT';
    slug: string;
    date: Date;
    laps: number;
    openf1SessionKey: number;
  };
  lineup: LineupRow[];
  positions: PositionRow[];
  events: EventRow[];
  results: ResultRow[];
  /**
   * Things that were survivable but not right — a driver with no position
   * samples at all, for instance. Surfaced rather than swallowed, because a
   * quietly incomplete import is worse than a loud failure.
   */
  warnings: string[];
};
