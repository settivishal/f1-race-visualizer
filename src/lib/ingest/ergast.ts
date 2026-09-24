import { z } from 'zod';
import { createThrottle } from './throttle';

/**
 * The Ergast adapter, served by Jolpica since Ergast itself was retired.
 *
 * This is the second upstream, and it exists for exactly what OpenF1 does not
 * publish: seasons before 2023, and starting grids in any season. It speaks
 * Ergast's vocabulary — season, round, driverId, constructorId — and nothing
 * downstream does, so a change to its shape has a blast radius of two files.
 *
 * It is never called from a request. It runs from the archive backfill, from
 * the offline feature builder (qualifying), and from the OpenF1 import, which
 * reads it to repair zeroed points and — per decisions.md 2026-09-24, "Ergast
 * is now read on every OpenF1 grand-prix import" — will read it for the grid.
 */
const BASE_URL = 'https://api.jolpi.ca/ergast/f1';

/**
 * Jolpica publishes 4 requests/second burst and 500/hour sustained, and says
 * both will tighten as authentication rolls out. 8 per minute is 480/hour —
 * under the ceiling with room for the limit to move, and a season's ~280
 * requests take about 35 minutes, which is why the backfill is a workflow and
 * not a serverless function.
 */
const throttle = createThrottle({ perSecond: 4, perMinute: 8 });

/** The hard cap on Ergast's page size. Asking for more silently returns 100. */
const PAGE_SIZE = 100;

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

    lastError = new Error(`Ergast ${path} returned ${response.status}`);
    if (!RETRYABLE.has(response.status)) throw lastError;
    if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}

// ── Schemas ───────────────────────────────────────────────────────────
// Ergast answers everything with numbers as strings, including positions and
// points. They are parsed here rather than downstream, so the transform works
// in numbers like every other transform in this codebase.

const numeric = z.string().transform((value) => Number(value));

export const ErgastCircuitSchema = z.object({
  circuitId: z.string(),
  circuitName: z.string(),
  Location: z.object({
    lat: z.string().optional(),
    long: z.string().optional(),
    locality: z.string().optional(),
    country: z.string().optional(),
  }),
});

export const ErgastDriverSchema = z.object({
  driverId: z.string(),
  permanentNumber: z.string().optional(),
  code: z.string().optional(),
  givenName: z.string(),
  familyName: z.string(),
  nationality: z.string().optional(),
});

export const ErgastConstructorSchema = z.object({
  constructorId: z.string(),
  name: z.string(),
  nationality: z.string().optional(),
});

export const ErgastResultSchema = z.object({
  number: z.string().optional(),
  position: numeric,
  /**
   * The classification as a token: a finishing position, or `R` retired, `D`
   * disqualified, `W` withdrawn, `E` excluded, `F` failed to qualify, `N` not
   * classified. `status` is prose ("Engine", "+1 Lap") and cannot be switched
   * on; this can.
   */
  positionText: z.string(),
  points: numeric,
  grid: numeric,
  laps: numeric,
  status: z.string(),
  Driver: ErgastDriverSchema,
  Constructor: ErgastConstructorSchema,
  FastestLap: z
    .object({ rank: z.string().optional(), lap: z.string().optional() })
    .optional(),
});

export const ErgastRaceSchema = z.object({
  season: numeric,
  round: numeric,
  raceName: z.string(),
  date: z.string(),
  time: z.string().optional(),
  Circuit: ErgastCircuitSchema,
  Results: z.array(ErgastResultSchema).optional(),
});

/**
 * One qualifying classification. Q1–Q3 lap times are left out: the feature
 * builder reads the order, and nothing reads the times.
 */
export const ErgastQualifyingResultSchema = z.object({
  number: z.string().optional(),
  position: numeric,
  Driver: ErgastDriverSchema,
  Constructor: ErgastConstructorSchema,
});

export const ErgastQualifyingRaceSchema = ErgastRaceSchema.omit({ Results: true }).extend({
  QualifyingResults: z.array(ErgastQualifyingResultSchema),
});

export const ErgastLapSchema = z.object({
  number: numeric,
  Timings: z.array(
    z.object({
      driverId: z.string(),
      position: numeric,
      /** `1:29.345`, or absent for a lap upstream never timed. */
      time: z.string().optional(),
    }),
  ),
});

export const ErgastPitStopSchema = z.object({
  driverId: z.string(),
  lap: numeric,
  stop: numeric,
  /** Seconds as a string: `22.213`. Occasionally `1:02.4` for a long stop. */
  duration: z.string().optional(),
});

export type ErgastRace = z.infer<typeof ErgastRaceSchema>;
export type ErgastQualifyingRace = z.infer<typeof ErgastQualifyingRaceSchema>;
export type ErgastLap = z.infer<typeof ErgastLapSchema>;
export type ErgastPitStop = z.infer<typeof ErgastPitStopSchema>;
export type ErgastResult = z.infer<typeof ErgastResultSchema>;
export type ErgastCircuit = z.infer<typeof ErgastCircuitSchema>;

// ── Endpoints ─────────────────────────────────────────────────────────

const EnvelopeSchema = z.object({
  MRData: z.object({
    total: z.string(),
    RaceTable: z.object({ Races: z.array(z.unknown()) }),
  }),
});

const CircuitTableSchema = z.object({
  MRData: z.object({
    CircuitTable: z.object({ Circuits: z.array(ErgastCircuitSchema) }),
  }),
});

/**
 * One page of a race-scoped endpoint, with `total` so the caller knows whether
 * to ask for another.
 *
 * Ergast nests everything under a race even when the query names one, and the
 * array is empty rather than absent for a season that has no such data — a
 * 2018 race has no pit stops published for the safety-car laps, and that is a
 * fact rather than a failure.
 */
async function getPage(
  path: string,
  offset: number,
): Promise<{ races: unknown[]; total: number }> {
  const raw = await get(path, { limit: PAGE_SIZE, offset });
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Ergast ${path} returned an unrecognised envelope: ${parsed.error.issues[0].message}`);
  }
  return {
    races: parsed.data.MRData.RaceTable.Races,
    total: Number(parsed.data.MRData.total),
  };
}

/**
 * Every page of one race-scoped endpoint, flattened by the caller's extractor.
 *
 * Paging is on the *records* — 937 lap timings for a 2018 race, ten requests —
 * not on the races, so each page carries the same single race with a different
 * slice of its rows inside.
 */
async function getAllRecords<T>(
  path: string,
  extract: (race: unknown) => unknown[],
  schema: z.ZodType<T>,
): Promise<T[]> {
  const records: unknown[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getPage(path, offset);
    total = page.total;
    for (const race of page.races) records.push(...extract(race));

    // A page that returns nothing while claiming more remain would spin
    // forever; upstream saying so is a bug on its side, not a reason to hang.
    if (page.races.length === 0) break;
    offset += PAGE_SIZE;
  }

  const parsed = z.array(schema).safeParse(records);
  if (!parsed.success) {
    throw new Error(`Ergast ${path} failed validation: ${parsed.error.issues[0].message} at ${parsed.error.issues[0].path.join('.')}`);
  }
  return parsed.data;
}

const racesOf = (raw: unknown): Record<string, unknown> =>
  (raw ?? {}) as Record<string, unknown>;

/**
 * Every circuit a season visited.
 *
 * Its own endpoint, and its own envelope: Ergast nests most answers under a
 * race, but `/{year}/circuits` nests under a CircuitTable, so this cannot go
 * through `getPage`.
 *
 * Scoped to a season rather than fetching all ~77 circuits Ergast knows,
 * because the circuits index would otherwise list places this database has no
 * race for — a page promising Estoril and holding nothing about it. One
 * request per season in the database keeps the list to what has actually been
 * imported.
 */
export async function fetchSeasonCircuits(year: number): Promise<ErgastCircuit[]> {
  const raw = await get(`/${year}/circuits.json`, { limit: PAGE_SIZE });
  const parsed = CircuitTableSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Ergast ${year} circuits returned an unrecognised envelope: ${parsed.error.issues[0].message}`);
  }
  // A season has at most ~24 circuits, comfortably inside one page, so there is
  // no paging loop here to go wrong.
  return parsed.data.MRData.CircuitTable.Circuits;
}

/**
 * Every race of one season-scoped endpoint, each race whole.
 *
 * A season paginates by *row*, so one race can arrive split across two pages —
 * twenty results, twenty-first on the next page; with a 22-car grid it happens
 * on most pages. Merging by round is what makes a page boundary invisible
 * instead of silently truncating a race. `merge` appends the second slice's
 * rows onto the first.
 */
async function fetchSeasonRaces<R extends { round: number }>(
  year: number,
  path: string,
  schema: z.ZodType<R>,
  merge: (into: R, from: R) => void,
): Promise<R[]> {
  const races: unknown[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getPage(path, offset);
    total = page.total;
    races.push(...page.races);
    if (page.races.length === 0) break;
    offset += PAGE_SIZE;
  }

  const byRound = new Map<number, R>();
  for (const raw of races) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Ergast season ${year} failed validation: ${parsed.error.issues[0].message}`);
    }
    const race = parsed.data;
    const existing = byRound.get(race.round);
    if (existing) merge(existing, race);
    else byRound.set(race.round, race);
  }

  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

/** Every race of a season, with results, drivers, constructors and the circuit. */
export const fetchSeasonResults = (year: number): Promise<ErgastRace[]> =>
  fetchSeasonRaces(year, `/${year}/results.json`, ErgastRaceSchema, (into, from) => {
    into.Results = [...(into.Results ?? []), ...(from.Results ?? [])];
  });

/**
 * Every qualifying session of a season that Ergast has published, in round
 * order. A round that has not been qualified yet is simply absent — whether
 * that is acceptable is the caller's decision, not this client's.
 *
 * Not stored: the feature builder is the only reader (see decisions.md,
 * 2026-09-24), and nothing on the site shows qualifying.
 */
export const fetchSeasonQualifying = (year: number): Promise<ErgastQualifyingRace[]> =>
  fetchSeasonRaces(year, `/${year}/qualifying.json`, ErgastQualifyingRaceSchema, (into, from) => {
    into.QualifyingResults = [...into.QualifyingResults, ...from.QualifyingResults];
  });

/**
 * Every lap of one race: position and lap time per driver per lap.
 *
 * Paging counts *timings*, not laps, so a lap on a page boundary arrives twice
 * — once with the first eleven cars and once with the rest. Merging by lap
 * number is what stops the second copy from overwriting the first and dropping
 * eleven drivers out of the running order on one lap of every race.
 */
export async function fetchRaceLaps(year: number, round: number): Promise<ErgastLap[]> {
  const pages = await getAllRecords(
    `/${year}/${round}/laps.json`,
    (race) => (racesOf(race).Laps as unknown[]) ?? [],
    ErgastLapSchema,
  );

  const byLap = new Map<number, ErgastLap>();
  for (const lap of pages) {
    const existing = byLap.get(lap.number);
    if (existing) existing.Timings = [...existing.Timings, ...lap.Timings];
    else byLap.set(lap.number, { ...lap, Timings: [...lap.Timings] });
  }
  return [...byLap.values()].sort((a, b) => a.number - b.number);
}

/** Pit stops, where the season has them — Ergast publishes these from 2011. */
export const fetchRacePitStops = (year: number, round: number) =>
  getAllRecords(
    `/${year}/${round}/pitstops.json`,
    (race) => (racesOf(race).PitStops as unknown[]) ?? [],
    ErgastPitStopSchema,
  );
