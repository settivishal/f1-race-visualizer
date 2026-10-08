import { z } from 'zod';
import { createJsonClient } from './http';
import { createThrottle } from './throttle';

/**
 * The OpenF1 adapter. This is the only module in the codebase that speaks
 * OpenF1's vocabulary — session_key, meeting_key, driver_number. Everything
 * downstream speaks in meetings, races, assignments and laps, so a change to
 * OpenF1's shape has a blast radius of one file.
 *
 * Every response is validated before anything else touches it. The value is
 * not defensiveness for its own sake, it is where the error surfaces: without
 * it, an upstream field going missing becomes an undefined written into a
 * column, or a TypeError deep inside the transform. With it, the failure names
 * the field and lands in ingest_runs.error as something readable.
 */
const BASE_URL = 'https://api.openf1.org/v1';

// Free tier: 3 requests/second, 30 requests/minute. Both hold at once.
const throttle = createThrottle({ perSecond: 3, perMinute: 30 });

// OpenF1 answers a query that matches nothing with 404, not an empty list.
// A sprint with no pit stops is a fact about the race, not a failure.
const get = createJsonClient({ name: 'OpenF1', baseUrl: BASE_URL, throttle, emptyOn404: true });

// ── Schemas ───────────────────────────────────────────────────────────
// Every field the transform reads is required; fields we ignore are omitted.
// Zod strips unknown keys by default, so upstream additions are non-events.

export const SessionSchema = z.object({
  session_key: z.number(),
  meeting_key: z.number(),
  session_name: z.string(),
  session_type: z.string(),
  date_start: z.string(),
  date_end: z.string(),
  year: z.number(),
  circuit_short_name: z.string().nullable(),
  country_name: z.string().nullable(),
});

export const MeetingSchema = z.object({
  meeting_key: z.number(),
  meeting_name: z.string(),
  country_name: z.string(),
  circuit_short_name: z.string().nullable(),
  date_start: z.string(),
  year: z.number(),
});

export const DriverSchema = z.object({
  driver_number: z.number(),
  name_acronym: z.string(),
  full_name: z.string(),
  team_name: z.string().nullable(),
  team_colour: z.string().nullable(),
  headshot_url: z.string().nullable(),
  country_code: z.string().nullable(),
});

export const LapSchema = z.object({
  driver_number: z.number(),
  lap_number: z.number(),
  date_start: z.string().nullable(),
  lap_duration: z.number().nullable(),
  duration_sector_1: z.number().nullable(),
  duration_sector_2: z.number().nullable(),
  duration_sector_3: z.number().nullable(),
  is_pit_out_lap: z.boolean().nullable(),
});

export const PositionSampleSchema = z.object({
  driver_number: z.number(),
  position: z.number(),
  date: z.string(),
});

export const PitSchema = z.object({
  driver_number: z.number(),
  lap_number: z.number(),
  pit_duration: z.number().nullable(),
  date: z.string(),
});

// lap_end is null for a stint still running when the session ended; upstream
// also emits stints with no compound during testing sessions.
export const StintSchema = z.object({
  driver_number: z.number(),
  stint_number: z.number(),
  lap_start: z.number().nullable(),
  lap_end: z.number().nullable(),
  compound: z.string().nullable(),
  tyre_age_at_start: z.number().nullable(),
});

export const RaceControlSchema = z.object({
  driver_number: z.number().nullable(),
  lap_number: z.number().nullable(),
  category: z.string(),
  flag: z.string().nullable(),
  scope: z.string().nullable(),
  message: z.string(),
  date: z.string(),
});

// position is null for anyone not classified; dnf/dns/dsq carry the reason.
export const SessionResultSchema = z.object({
  driver_number: z.number(),
  position: z.number().nullable(),
  number_of_laps: z.number().nullable(),
  points: z.number().nullable(),
  dnf: z.boolean(),
  dns: z.boolean(),
  dsq: z.boolean(),
});

export const WeatherSchema = z.looseObject({ date: z.string() });

export type Session = z.infer<typeof SessionSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type Driver = z.infer<typeof DriverSchema>;
export type Lap = z.infer<typeof LapSchema>;
export type PositionSample = z.infer<typeof PositionSampleSchema>;
export type Pit = z.infer<typeof PitSchema>;
export type Stint = z.infer<typeof StintSchema>;
export type RaceControl = z.infer<typeof RaceControlSchema>;
export type SessionResult = z.infer<typeof SessionResultSchema>;
export type Weather = z.infer<typeof WeatherSchema>;

// ── Endpoints ─────────────────────────────────────────────────────────

async function getList<T>(
  path: string,
  params: Record<string, string | number>,
  schema: z.ZodType<T>,
): Promise<T[]> {
  const raw = await get(path, params);
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`OpenF1 ${path} failed validation: ${parsed.error.issues[0].message} at ${parsed.error.issues[0].path.join('.')}`);
  }
  return parsed.data;
}

export const fetchSessions = (year: number) => getList('/sessions', { year }, SessionSchema);
export const fetchMeetings = (year: number) => getList('/meetings', { year }, MeetingSchema);
/**
 * One session by its key. `/sessions` takes `session_key` directly, which is
 * worth having as its own call: the alternative — and what run.ts used to do —
 * is to fetch whole seasons looking for it, from a hardcoded list of years that
 * silently stops finding anything the January after it was written.
 */
export const fetchSessionByKey = (sessionKey: number) =>
  getList('/sessions', { session_key: sessionKey }, SessionSchema);
export const fetchDrivers = (sessionKey: number) =>
  getList('/drivers', { session_key: sessionKey }, DriverSchema);
export const fetchLaps = (sessionKey: number) =>
  getList('/laps', { session_key: sessionKey }, LapSchema);
export const fetchPositions = (sessionKey: number) =>
  getList('/position', { session_key: sessionKey }, PositionSampleSchema);
export const fetchPits = (sessionKey: number) =>
  getList('/pit', { session_key: sessionKey }, PitSchema);
export const fetchStints = (sessionKey: number) =>
  getList('/stints', { session_key: sessionKey }, StintSchema);
export const fetchRaceControl = (sessionKey: number) =>
  getList('/race_control', { session_key: sessionKey }, RaceControlSchema);
export const fetchSessionResults = (sessionKey: number) =>
  getList('/session_result', { session_key: sessionKey }, SessionResultSchema);
export const fetchWeather = (sessionKey: number) =>
  getList('/weather', { session_key: sessionKey }, WeatherSchema);
