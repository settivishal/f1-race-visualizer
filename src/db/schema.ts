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

// ── Reference data ────────────────────────────────────────────────

export const seasons = pgTable('seasons', {
  year: integer('year').primaryKey(),            // natural key — removes a join everywhere
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  color: text('color'),                          // hex, drives the replay palette
  logoUrl: text('logo_url'),                     // our Vercel Blob URL, not upstream
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),         // VER, HAM
  name: text('name').notNull(),
  number: integer('number'),
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

// ── Race weekend ──────────────────────────────────────────────────

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonYear: integer('season_year').notNull().references(() => seasons.year),
  round: integer('round').notNull(),
  name: text('name').notNull(),                  // "São Paulo Grand Prix"
  country: text('country').notNull(),
  circuitName: text('circuit_name'),
  startDate: timestamp('start_date', { withTimezone: true }).notNull(),
  weather: jsonb('weather'),                     // upstream shape, read-only for us
  openf1MeetingKey: integer('openf1_meeting_key').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('meetings_season_round_uq').on(t.seasonYear, t.round)]);

export const races = pgTable('races', {
  id: uuid('id').primaryKey().defaultRandom(),
  meetingId: uuid('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  type: raceType('type').notNull(),
  slug: text('slug').notNull().unique(),         // "2025-sao-paulo", "2025-sao-paulo-sprint"
  date: timestamp('date', { withTimezone: true }).notNull(),
  laps: integer('laps').notNull(),
  isFeatured: boolean('is_featured').notNull().default(false),
  openf1SessionKey: integer('openf1_session_key').unique(),
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
}, (t) => [check('app_config_single_row', sql`${t.id} = 1`)]);  // one row, enforced in SQL

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
}));

export const meetingsRelations = relations(meetings, ({ one, many }) => ({
  season: one(seasons, { fields: [meetings.seasonYear], references: [seasons.year] }),
  races: many(races),
}));

export const racesRelations = relations(races, ({ one, many }) => ({
  meeting: one(meetings, { fields: [races.meetingId], references: [meetings.id] }),
  positions: many(racePositions),
  events: many(raceEvents),
  results: many(raceResults),
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
