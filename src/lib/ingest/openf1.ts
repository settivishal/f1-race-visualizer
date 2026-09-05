import { z } from 'zod';
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

const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path: string, params: Record<string, string | number>): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await throttle(() => fetch(url, { headers: { accept: 'application/json' } }));
    if (response.ok) return response.json();

    lastError = new Error(`OpenF1 ${path} returned ${response.status}`);
    if (!RETRYABLE.has(response.status)) throw lastError;

    // Exponential backoff. A 429 means the throttle's view of the window and
    // the server's have drifted, so waiting longer than the gap is the point.
    if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}

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
export const fetchDrivers = (sessionKey: number) =>
  getList('/drivers', { session_key: sessionKey }, DriverSchema);
export const fetchLaps = (sessionKey: number) =>
  getList('/laps', { session_key: sessionKey }, LapSchema);
export const fetchPositions = (sessionKey: number) =>
  getList('/position', { session_key: sessionKey }, PositionSampleSchema);
export const fetchPits = (sessionKey: number) =>
  getList('/pit', { session_key: sessionKey }, PitSchema);
export const fetchRaceControl = (sessionKey: number) =>
  getList('/race_control', { session_key: sessionKey }, RaceControlSchema);
export const fetchSessionResults = (sessionKey: number) =>
  getList('/session_result', { session_key: sessionKey }, SessionResultSchema);
export const fetchWeather = (sessionKey: number) =>
  getList('/weather', { session_key: sessionKey }, WeatherSchema);
