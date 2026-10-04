import {
  pgTable, pgEnum, uuid, text, integer, real, boolean, jsonb,
  timestamp, uniqueIndex, index, primaryKey, check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const raceType     = pgEnum('race_type', ['GRAND_PRIX', 'SPRINT']);
export const driverStatus = pgEnum('driver_status', ['FINISHED', 'DNF', 'DNS', 'DSQ']);
export const eventType    = pgEnum('event_type', [
  'OVERTAKE', 'PIT_STOP', 'RETIREMENT', 'SAFETY_CAR', 'VIRTUAL_SAFETY_CAR',
  'RED_FLAG', 'FASTEST_LAP', 'PENALTY', 'OTHER',
]);
export const ingestStatus = pgEnum('ingest_status', ['RUNNING', 'SUCCESS', 'FAILED']);

/**
 * How much of a race we have, which is a fact about its era rather than about
 * the import.
 *
 * `FULL` is OpenF1's 2023-onward coverage: sectors, gap strings, race control
 * and tyre stints. `LAPS` is what Ergast serves for 2018-2022 — position and
 * lap time per lap, and nothing else. The UI branches on this rather than
 * checking whether a column happens to be null, because a missing sector time
 * means "this era published none" in one case and "the ingest dropped rows" in
 * the other, and those must not look the same.
 */
export const dataTier = pgEnum('data_tier', ['FULL', 'LAPS']);

// ── Reference data ────────────────────────────────────────────────

export const seasons = pgTable('seasons', {
  year: integer('year').primaryKey(),            // natural key — removes a join everywhere
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  // Ergast's stable key ("ferrari", "red_bull"). A constructor's *name* changes
  // — Racing Point to Aston Martin, Toro Rosso to AlphaTauri to Racing Bulls —
  // so matching an archive import on the name alone would create a new team the
  // first time one was rebranded. Null for teams only OpenF1 has seen.
  ergastConstructorId: text('ergast_constructor_id').unique(),
  color: text('color'),                          // hex, drives the replay palette
  logoUrl: text('logo_url'),                     // our Vercel Blob URL, not upstream
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Still unique, deliberately. Codes are not unique across the whole history
  // of the sport, but they are within the 2018+ window this project covers, and
  // the constraint is what the OpenF1 ingest upserts against — it has no Ergast
  // id to use instead. Revisit only if the archive is ever extended backwards.
  code: text('code').notNull().unique(),         // VER, HAM
  // Ergast's stable key ("max_verstappen"). What an archive import matches on
  // first, falling back to the code for a driver OpenF1 imported already.
  ergastDriverId: text('ergast_driver_id').unique(),
  name: text('name').notNull(),
  number: integer('number'),
  // The season the stored number came from. Numbers change — a champion runs 1
  // — and the driver row holds one, so an import has to know whether the number
  // it is carrying is newer than the one already there. Without this the rule
  // was last-write-wins, and backfilling 2018 would have put Verstappen back on
  // 33 across the whole site.
  numberSeason: integer('number_season'),
  country: text('country'),
  headshotUrl: text('headshot_url'),             // our Vercel Blob URL
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A team fields a lineup per season; drivers move between teams.
export const teamSeasons = pgTable('team_seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonYear: integer('season_year').notNull().references(() => seasons.year),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  color: text('color'),                          // per-season livery; falls back to teams.color
}, (t) => [uniqueIndex('team_seasons_season_team_uq').on(t.seasonYear, t.teamId)]);

export const driverTeamAssignments = pgTable('driver_team_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamSeasonId: uuid('team_season_id').notNull().references(() => teamSeasons.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
}, (t) => [uniqueIndex('dta_team_season_driver_uq').on(t.teamSeasonId, t.driverId)]);

/**
 * Circuits, from Ergast.
 *
 * This replaces `lib/circuit-data.ts`, a hardcoded table keyed by country and
 * race name. Keyed by country it cannot tell Spain 2019 from Spain 2025, and it
 * has no key at all for a circuit that has left the calendar — Hockenheim,
 * Sochi, Paul Ricard, all inside the 2018 window.
 *
 * `lengthKm`, `turns` and `firstGrandPrix` are not in Ergast and stay a small
 * hand-maintained overlay: static facts about physical places, which is the one
 * kind of data that genuinely does not need an API.
 */
export const circuits = pgTable('circuits', {
  id: uuid('id').primaryKey().defaultRandom(),
  ergastCircuitId: text('ergast_circuit_id').notNull().unique(),  // "albert_park"
  name: text('name').notNull(),
  locality: text('locality'),
  country: text('country'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  lengthKm: real('length_km'),
  turns: integer('turns'),
  firstGrandPrix: integer('first_grand_prix'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Race weekend ──────────────────────────────────────────────────

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonYear: integer('season_year').notNull().references(() => seasons.year),
  round: integer('round').notNull(),
  name: text('name').notNull(),                  // "São Paulo Grand Prix"
  adminEdited: text('admin_edited').array().notNull().default([]),
  country: text('country').notNull(),
  circuitName: text('circuit_name'),
  // Nullable: every meeting OpenF1 imported has a circuit *name* and no circuit
  // row until the archive import supplies one, and a name is still enough to
  // render a race.
  circuitId: uuid('circuit_id').references(() => circuits.id),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  weather: jsonb('weather'),                     // upstream shape, read-only for us
  openf1MeetingKey: integer('openf1_meeting_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('meetings_season_round_uq').on(t.seasonYear, t.round)]);

/**
 * What happened to a scheduled race.
 *
 * `laps = 0` used to carry all of this: not yet run, cancelled, and imported
 * but empty were the same value, so the two 2026 races abandoned in April
 * rendered as upcoming with a countdown to a date months gone.
 *
 * COMPLETED and SCHEDULED are set by the ingest from whether positions exist.
 * CANCELLED is only ever an admin's word — no upstream publishes it — and is
 * protected from being overwritten by `admin_edited`.
 */
export const raceStatus = pgEnum('race_status', ['SCHEDULED', 'COMPLETED', 'CANCELLED']);

export const races = pgTable('races', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  type: raceType('type').notNull(),
  slug: text('slug').notNull().unique(),         // "2025-sao-paulo", "2025-sao-paulo-sprint"
  status: raceStatus('status').notNull().default('SCHEDULED'),
  // Columns an admin has set by hand, which the ingest must not overwrite.
  // See sqlAdminWins in lib/ingest/run.ts. Clearing a field in the admin drops
  // it from this list, and the next import restores what upstream says.
  adminEdited: text('admin_edited').array().notNull().default([]),
  date: timestamp('date', { withTimezone: true }).notNull(),
  laps: integer('laps').notNull(),
  isFeatured: boolean('is_featured').notNull().default(false),
  // FULL is right for every row that exists today: all of them came from
  // OpenF1. The archive import sets LAPS on what it writes.
  dataTier: dataTier('data_tier').notNull().default('FULL'),
  openf1SessionKey: integer('openf1_session_key').unique(),
  // Ergast addresses a race by season and round, which is also how a re-import
  // finds it again. Null for anything Ergast has never seen.
  ergastRound: integer('ergast_round'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('races_meeting_type_uq').on(t.meetingId, t.type)]);

// ── Race data (the replay payload) ────────────────────────────────

export const racePositions = pgTable('race_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  lap: integer('lap').notNull(),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  position: integer('position').notNull(),
  gap: text('gap'),                              // "+1.234" or "LAP 1" — upstream is a string
  lapTime: real('lap_time'),
  sector1: real('sector_1'),
  sector2: real('sector_2'),
  sector3: real('sector_3'),
}, (t) => [
  uniqueIndex('race_positions_lap_driver_uq').on(t.raceId, t.lap, t.assignmentId),
  uniqueIndex('race_positions_lap_position_uq').on(t.raceId, t.lap, t.position),
  index('race_positions_race_lap_idx').on(t.raceId, t.lap),
]);

export const raceEvents = pgTable('race_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  lap: integer('lap').notNull(),
  assignmentId: uuid('assignment_id').references(() => driverTeamAssignments.id),  // null = race-wide
  type: eventType('type').notNull(),
  details: text('details').notNull(),
}, (t) => [index('race_events_race_lap_idx').on(t.raceId, t.lap)]);

/**
 * A tyre stint: the laps between two pit stops. Upstream gives the compound and
 * the lap range, not a per-lap tyre, because that is the shape the data has —
 * expanding it to one row per lap would be the same fact stored sixty times.
 */
export const stints = pgTable('stints', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  stintNumber: integer('stint_number').notNull(),
  lapStart: integer('lap_start').notNull(),
  lapEnd: integer('lap_end').notNull(),
  compound: text('compound'),                    // SOFT | MEDIUM | HARD | INTERMEDIATE | WET
  tyreAgeAtStart: integer('tyre_age_at_start'),  // laps already on the set when fitted
}, (t) => [
  // No separate race_id index: this one is already prefixed by race_id, which
  // is the only way these rows are ever looked up.
  uniqueIndex('stints_race_driver_stint_uq').on(t.raceId, t.assignmentId, t.stintNumber),
]);

/**
 * Pit stops as data rather than prose. The duration has always been ingested,
 * but only ever survived inside a race event's `details` string, where nothing
 * can compare two stops or sum a team's pit time.
 */
export const pitStops = pgTable('pit_stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  lap: integer('lap').notNull(),
  durationMs: integer('duration_ms'),            // null when upstream timed no stop
}, (t) => [
  uniqueIndex('pit_stops_race_driver_lap_uq').on(t.raceId, t.assignmentId, t.lap),
]);

// Final classification. v1 had no home for this and faked DNFs through events.
export const raceResults = pgTable('race_results', {
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  gridPosition: integer('grid_position'),
  finalPosition: integer('final_position'),      // null when not classified
  status: driverStatus('status').notNull(),
  lapsCompleted: integer('laps_completed').notNull().default(0),
  points: real('points').notNull().default(0),
  fastestLap: boolean('fastest_lap').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.raceId, t.assignmentId] })]);

/**
 * Pre-race win probabilities, from the model in ml/ via
 * scripts/import-predictions.ts. Python never writes here.
 *
 * Keyed by driver, not assignment: a prediction is published on Saturday night,
 * and a race's lineup is only written once it has run. `model_version` is in
 * the key so two models can be compared on the same race.
 */
export const racePredictions = pgTable('race_predictions', {
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  winProbability: real('win_probability').notNull(),
  modelVersion: text('model_version').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.raceId, t.driverId, t.modelVersion] })]);

// ── Operations ────────────────────────────────────────────────────

export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),              // 'openf1' | 'images'
  target: text('target'),                        // race slug or season
  status: ingestStatus('status').notNull(),
  rowsWritten: integer('rows_written').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('ingest_runs_started_idx').on(t.startedAt)]);

export const appConfig = pgTable('app_config', {
  id: integer('id').primaryKey().default(1),
  ingestEnabled: boolean('ingest_enabled').notNull().default(true),
  runDays: text('run_days').array().notNull().default(['mon']),
  activeSeason: integer('active_season').notNull(),
  hoursAfterRace: integer('hours_after_race').notNull().default(12),
  // The race page's win prediction panel: how many drivers it lists, and how
  // many "Show more" opens it to. Drivers past the second number are not shown.
  predictionsShown: integer('predictions_shown').notNull().default(5),
  predictionsExpanded: integer('predictions_expanded').notNull().default(10),
}, (t) => [check('app_config_single_row', sql`${t.id} = 1`)]);  // one row, enforced in SQL

/**
 * One row per rate-limited caller, holding a token bucket. Written on every
 * limited request, so it is deliberately narrow: a key, a balance, and when
 * the balance was last touched. Rows for callers who stop calling simply sit
 * there costing a few bytes; there is no cleanup job, because a table with one
 * row per recent IP is smaller than the index it would need to prune.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  tokens: real('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Relations (Drizzle query API + Pothos type mapping) ───────────

export const seasonsRelations = relations(seasons, ({ many }) => ({
  meetings: many(meetings),
  teamSeasons: many(teamSeasons),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  teamSeasons: many(teamSeasons),
}));

export const driversRelations = relations(drivers, ({ many }) => ({
  assignments: many(driverTeamAssignments),
}));

export const teamSeasonsRelations = relations(teamSeasons, ({ one, many }) => ({
  season: one(seasons, { fields: [teamSeasons.seasonYear], references: [seasons.year] }),
  team: one(teams, { fields: [teamSeasons.teamId], references: [teams.id] }),
  assignments: many(driverTeamAssignments),
}));

export const driverTeamAssignmentsRelations = relations(driverTeamAssignments, ({ one, many }) => ({
  driver: one(drivers, { fields: [driverTeamAssignments.driverId], references: [drivers.id] }),
  teamSeason: one(teamSeasons, { fields: [driverTeamAssignments.teamSeasonId], references: [teamSeasons.id] }),
  positions: many(racePositions),
  events: many(raceEvents),
  results: many(raceResults),
  stints: many(stints),
  pitStops: many(pitStops),
}));

export const circuitsRelations = relations(circuits, ({ many }) => ({
  meetings: many(meetings),
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  season: one(seasons, { fields: [meetings.seasonYear], references: [seasons.year] }),
  circuit: one(circuits, { fields: [meetings.circuitId], references: [circuits.id] }),
  races: many(races),
}));

export const racesRelations = relations(races, ({ one, many }) => ({
  meeting: one(meetings, { fields: [races.meetingId], references: [meetings.id] }),
  positions: many(racePositions),
  events: many(raceEvents),
  results: many(raceResults),
  stints: many(stints),
  pitStops: many(pitStops),
}));

export const stintsRelations = relations(stints, ({ one }) => ({
  race: one(races, { fields: [stints.raceId], references: [races.id] }),
  assignment: one(driverTeamAssignments, {
    fields: [stints.assignmentId], references: [driverTeamAssignments.id],
  }),
}));

export const pitStopsRelations = relations(pitStops, ({ one }) => ({
  race: one(races, { fields: [pitStops.raceId], references: [races.id] }),
  assignment: one(driverTeamAssignments, {
    fields: [pitStops.assignmentId], references: [driverTeamAssignments.id],
  }),
}));

export const racePositionsRelations = relations(racePositions, ({ one }) => ({
  race: one(races, { fields: [racePositions.raceId], references: [races.id] }),
  assignment: one(driverTeamAssignments, {
    fields: [racePositions.assignmentId], references: [driverTeamAssignments.id],
  }),
}));

export const raceEventsRelations = relations(raceEvents, ({ one }) => ({
  race: one(races, { fields: [raceEvents.raceId], references: [races.id] }),
  assignment: one(driverTeamAssignments, {
    fields: [raceEvents.assignmentId], references: [driverTeamAssignments.id],
  }),
}));

export const raceResultsRelations = relations(raceResults, ({ one }) => ({
  race: one(races, { fields: [raceResults.raceId], references: [races.id] }),
  assignment: one(driverTeamAssignments, {
    fields: [raceResults.assignmentId], references: [driverTeamAssignments.id],
  }),
}));
