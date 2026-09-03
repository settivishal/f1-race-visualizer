# System Design

## Context

The v1 repo (`settivishal/f1-race-visualizer`) is being abandoned. It worked, but it grew across 7 phases and 20+ branches with no up-front design, and now carries: Prisma schema drift on `dev` (Prediction/RaceScore models with no migration), a schema mangled by `prisma db pull`, committed junk (`temp.json`, `fix-lint.js`, `dev.db`, `test-db.js`, `check-races.ts`), a hardcoded `admin`/`admin123` login backdoor on `feature/supabase`, and three feature branches mutually divergent on auth.

Root cause of most of it: **auth, data flow, and deployment were never decided, so each was rewritten under pressure three times.** v2 fixes that by deciding first. This document is the design.

v1 is not thrown away — it is the reference implementation. Working code (the replay engine, circuit geometry, the OpenF1 import logic) gets ported, not rewritten from memory.

---

## Decisions

| Area | Decision |
|---|---|
| Scope (v2 core) | Replay engine + public site + standings + admin/ingestion. Public accounts and the Armchair Strategist game are **deferred**, not cut. |
| Seed data | **Full 2025 season** (~24 races) backfilled. 2026 races land automatically via cron as they run. |
| Audience | Portfolio / showcase. Low traffic, near-zero cost, optimize for shipping and demoing. |
| Architecture | **Single Next.js app.** No separate API service. Route handlers + server components. |
| Auth | **Auth.js (NextAuth v5) credentials provider, one admin user.** Public pages fully public. |
| Database | **Neon Postgres + Drizzle ORM.** Migrations are the only source of truth. |
| API layer | **GraphQL** — Yoga + Pothos (code-first) at `/api/graphql`. One schema serves all reads and admin mutations. urql + graphql-codegen on the client. |
| Data pipeline | **Scheduled ingest into own DB.** Vercel Cron → protected route handler. App never calls an external API at request time. |
| Upstream data | **OpenF1 only.** Wikipedia for images. No Ergast/Jolpica. |
| Standings | **Derived from `race_results`** by aggregate query. No stored snapshot. |
| Deployment | **Vercel** (push to deploy, preview per PR) + Neon. Default `*.vercel.app` domain — no custom domain for now. GitHub Actions for lint/typecheck/test and for long backfills. |
| Update cadence | Cron fires **daily**; the handler decides whether work is due. Target window is Monday morning (after Sunday races), overridable without a redeploy. |
| Replay engine | **Port v1's rendering**, rebuild its data contract — one typed GraphQL payload replaces v1's prop drilling. |
| UI components | **Port v1's `components/ui/*`** — already match the F1 dark theme. No shadcn/ui. |
| Images | **Downloaded at ingest into Vercel Blob.** DB stores our own URLs. No hotlinking. |
| Rendering | **ISR.** Public pages are statically cached; a successful ingest revalidates by tag. |
| Migrations | Applied by a **GitHub Action on merge to `main`**, never by the Vercel build. |
| GraphQL hardening | Depth + cost limits always on. Introspection and GraphiQL **dev only**. |
| Testing | Vitest on `transform` + GraphQL resolvers against **PGlite**, one Playwright smoke test. Vercel logs only, no Sentry. |

### Why these, briefly

- **Single app** — v1's Next↔Nest split forced CORS config, an `x-web-origin` header hack, and duplicated auth plumbing, for one developer at portfolio traffic. Server components read Postgres directly; the race page needs no HTTP hop at all.
- **Auth.js credentials** — the only account is the admin's. No signup, no verification, no password reset, no email provider, no third-party dependency. Roughly 50 lines replacing v1's entire auth module. If public accounts return, Auth.js adds OAuth providers without a rewrite.
- **Drizzle** — v1's specific failure was schema drift from `db pull`. Drizzle's schema is TypeScript that generates SQL migrations; there is no round-trip that can silently overwrite the model. Also lighter on serverless cold starts.
- **Scheduled ingest** — v1 hit `api.openf1.org` and `api.jolpi.ca` live on every request with no cache. Reading only our own DB means the site is fast, works when upstream is down, and cannot be rate-limited.
- **ISR over dynamic rendering** — race data changes once a week, so rendering it per request is pure waste. Statically cached pages mean a visitor never waits on a Neon cold start, and Neon's free tier is never woken by traffic at all. The ingest job already knows exactly when the data changed, so it revalidates the tag itself; nothing is ever stale for longer than it takes to write the rows.
- **OpenF1 as the only upstream** — once standings are derived from `race_results`, the second source had no job left. `/session_result` already returns final position, status, and points for the 2023+ range that is the entire scope. One client, one rate limit, one failure mode. The cost is real and accepted: no pre-2023 season can ever be imported.
- **GraphQL** — an explicit learning goal, not an architectural necessity: server components could query Drizzle directly. It is made genuine by being *the* data layer rather than a veneer, so the parts worth learning are unavoidable — schema design, resolver composition, DataLoader batching, pagination, fragments, codegen. Pothos infers types from Drizzle models, so the schema cannot drift from the database.

---

## System design

### Architecture

```text
   EXTERNAL (touched only by cron, never by a page request)
   ┌────────────────────────┐   ┌────────────────┐
   │ api.openf1.org         │   │ Wikipedia      │
   │ laps · positions · pit │   │ driver images  │
   │ race_control · results │   │                │
   └───────────┬────────────┘   └───────┬────────┘
               │                        │
               └─────┬──────────────────┘
                     │ fetch + zod validate
      ┌──────────────▼───────────────┐        ┌──────────────────────┐
      │  lib/ingest                  │        │ scripts/backfill.ts  │
      │  openf1 · images             │◄───────┤ full-season import   │
      │  transform  (pure, tested)   │        │ local / GH Actions   │
      │  run  (upsert in tx)         │        │ no timeout limit     │
      └────────┬─────────────┬───────┘        └──────────────────────┘
               │             │ headshots, logos (once, at ingest)
               │             ▼
               │   ┌──────────────────────┐
               │   │  VERCEL BLOB         │  our URLs, optimizable
               │   │  driver + team art   │  no Wikipedia hotlink
               │   └──────────────────────┘
               │ writes + records ingest_runs
               ▼
        ╔════════════════════════════════════════╗
        ║   NEON POSTGRES                        ║
        ║   seasons · teams · drivers            ║
        ║   team_seasons · driver_team_assignments║
        ║   races · race_positions · race_events ║
        ║   race_results        · ingest_runs    ║
        ║   users (one admin)  · app_config      ║
        ╚════════════════════▲═══════════════════╝
                             │ Drizzle
                     ┌───────┴────────┐
                     │  loaders.ts    │  DataLoader — batches
                     │  (per request) │  driver/team/assignment
                     └───────▲────────┘
                             │
                  ┌──────────┴───────────┐
                  │  GraphQL schema      │   Pothos, code-first
                  │  Query · Mutation    │   types inferred from Drizzle
                  │  auth checked in     │
                  │  resolver context    │
                  └──▲────────────────▲──┘
      in-process     │                │   HTTP POST
      execute()      │                │
        ┌────────────┴───┐      ┌─────┴──────────────┐
        │ Server         │      │ /api/graphql       │
        │ Components     │      │ (Yoga handler)     │
        │ race page,     │      └─────▲──────────────┘
        │ library, SEO   │            │ urql + codegen hooks
        └────────────────┘      ┌─────┴──────────────┐
                                │ Client Components  │
                                │ replay explorer,   │
                                │ filters, standings,│
                                │ admin forms        │
                                └────────────────────┘

              ┌─────────────────────────────────────┐
              │ middleware.ts → /admin/* → Auth.js  │
              │ session (JWT, credentials, 1 admin) │
              └─────────────────────────────────────┘
```

### Request paths — why the split matters

```text
PUBLIC PAGE LOAD — cache hit (the common case)
  browser → Vercel edge cache → HTML. No resolver, no Drizzle, no Neon.

PUBLIC PAGE LOAD — cache miss or post-ingest revalidation
  browser → Vercel → server component → execute() → resolvers
          → DataLoader → Drizzle → Neon → HTML streamed back + cached

INTERACTIVE WIDGET  (replay scrub, filter, admin edit)
  browser → POST /api/graphql → Yoga → [session check if admin field]
          → resolvers → DataLoader → Drizzle → Neon → JSON

SCHEDULED UPDATE  (Monday morning, no user involved)
  Vercel Cron → POST /api/cron/ingest  [CRON_SECRET]
          → read app_config → is work due?
          → fetch OpenF1 → transform → upsert one race in a tx
          → write ingest_runs → revalidateTag('race' | 'standings') → 200

MANUAL UPDATE  (you, from the admin panel or your phone)
  admin UI → triggerIngest mutation → same lib/ingest code path
```

The point of the split: **external APIs appear exactly once**, at the top, reachable only by ingest. No page render can ever be slowed or broken by OpenF1 being down or rate-limiting — v1's central flaw.

### Asset handling

Images are fetched **once, at ingest**, not at render:

```text
ingest driver → has headshotUrl on our blob?  → yes: done
                                              → no:  fetch Wikipedia/OpenF1 image
                                                     → put() to Vercel Blob
                                                     → store returned URL on drivers row
```

Pages then serve `drivers.headshotUrl` through `next/image` with optimization **on** — v1 had to disable it because the sources were remote and unstable. Team logos follow the same path. A missing image falls back to a team-colour initials badge, so a failed fetch never blocks an ingest.

### Ingest scheduling

Vercel Cron schedules live in `vercel.json` and are static — changing one needs a redeploy. On the Hobby plan a job may run **at most once per day**, the schedule is interpreted in **UTC**, and Vercel fires it at any minute inside the stated hour (`0 6 * * *` means somewhere in 06:00–06:59). A daily job is exactly what this design wants, so none of that constrains us; it does mean the schedule cannot become the place where cadence lives. So the schedule is deliberately dumb and the **handler** is smart:

```text
vercel.json:  { "crons": [{ "path": "/api/cron/ingest", "schedule": "0 6 * * *" }] }
                                                          daily 06:00 UTC

handler logic:
  cfg = SELECT * FROM app_config
  if not cfg.ingestEnabled            -> 200 {skipped: "disabled"}
  if now.weekday not in cfg.runDays   -> 200 {skipped: "not a run day"}   # default ["mon"]
  race = next race in cfg.activeSeason with no positions
  if none                             -> 200 {skipped: "up to date"}
  ingest(race)
  revalidateTag('race'); revalidateTag('standings')
                                      -> 200 {ingested: race.name}
```

Revalidation is the last step and only runs after the transaction commits, so a failed ingest leaves the cached pages serving the last good data rather than dropping the cache on the floor.

`app_config` (single row: `ingestEnabled`, `runDays`, `activeSeason`, `hoursAfterRace`) is editable from the admin panel, so cadence changes need no deploy. Monday morning is just the default. One race per invocation keeps every run well inside the function timeout; a backlog drains a race per day, and `scripts/backfill.ts` exists for anything bigger.

---

## Target structure

```text
f1-race-visualizer/               # single Next.js project at repo root
├── src/
│   ├── app/
│   │   ├── (public)/             # /, /about, /races, /races/[slug], /standings
│   │   ├── admin/                # guarded by middleware
│   │   └── api/
│   │       ├── graphql/          # Yoga handler — the app's data API
│   │       ├── auth/[...nextauth]/
│   │       └── cron/ingest/      # CRON_SECRET-protected
│   ├── components/
│   │   ├── race-visualization/   # ported from v1, near-verbatim
│   │   └── ui/
│   ├── graphql/
│   │   ├── builder.ts            # Pothos builder + context type
│   │   ├── schema/               # race.ts, driver.ts, standings.ts, admin.ts
│   │   ├── loaders.ts            # DataLoader instances, one set per request
│   │   ├── execute.ts            # in-process execution for server components
│   │   ├── operations/           # .graphql documents used by client components
│   │   └── generated/            # graphql-codegen output — committed, never edited
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema — hand-written, source of truth
│   │   ├── index.ts              # Neon client — neon-serverless Pool (needs transactions)
│   │   └── migrations/           # generated, committed, never edited by hand
│   ├── lib/
│   │   ├── ingest/               # openf1.ts, images.ts, transform.ts, run.ts
│   │   └── circuit-data.ts       # ported from v1
│   └── auth.ts                   # Auth.js config
├── .github/workflows/            # ci.yml (lint/typecheck/test), migrate.yml (on merge to main)
├── middleware.ts                 # /admin/* guard
├── vercel.json                   # cron schedule
├── scripts/backfill.ts           # long imports, run locally or via Actions
├── codegen.ts
└── drizzle.config.ts
```

---

## GraphQL layer

**One schema, two transports.** Resolvers are written once and reached two ways:

- **Server components** call `src/graphql/execute.ts`, which runs `graphql.execute()` against the schema in-process. No HTTP request, no serialization round-trip, no localhost fetch — the race page renders as fast as a direct Drizzle query would.
- **Client components** (replay explorer, race library filters, standings tables, admin forms) POST to `/api/graphql` using urql with codegen-generated typed hooks.

**Schema sketch:**

```graphql
type Query {
  races(season: Int, search: String, first: Int, after: String): RaceConnection!
  race(slug: String!): Race
  seasons: [Season!]!
  driverStandings(season: Int!): [DriverStanding!]!
  constructorStandings(season: Int!): [ConstructorStanding!]!
  ingestRuns(first: Int): [IngestRun!]!        # admin only
}

type Mutation {
  triggerIngest(sessionKey: Int!): IngestRun!  # admin only
  setRaceFeatured(id: ID!, featured: Boolean!): Race!
  updateRaceMetadata(id: ID!, input: RaceMetadataInput!): Race!
}

type Race {
  id: ID!  slug: String!  type: RaceType!  date: DateTime!
  laps: Int!  isFeatured: Boolean!
  meeting: Meeting!                        # name, country, circuit, weather live here
  replay: RaceReplay!                      # the replay payload, driver-centric
  positions(lap: Int): [RacePosition!]!    # flat per-lap slice, for the timing tower
  events(lap: Int): [RaceEvent!]!
  results: [RaceResult!]!                  # final classification, DNF status
}

# One object per race, shaped the way the ported v1 components already consume it.
# A flat position list would make the client re-pivot ~1200 rows on every render.
type RaceReplay {
  summary: ReplaySummary!                  # lapCount, maxLap, maxPosition, driverCount
  laps: [Int!]!
  drivers: [ReplayDriver!]!                # each with its own position series
  events: [RaceEvent!]!
}

type Meeting {
  id: ID!  round: Int!  name: String!  country: String!
  circuitName: String  weather: JSON  season: Season!
  races: [Race!]!                          # grand prix + sprint
}

# Computed from race_results, not stored. Position is the rank, not a column.
type DriverStanding {
  position: Int!  driver: Driver!  team: Team!
  points: Float!  wins: Int!  podiums: Int!
}

type ConstructorStanding {
  position: Int!  team: Team!  points: Float!  wins: Int!
}
```

**N+1 is the real lesson here.** `race.positions → assignment → driver → team` across ~1200 rows is exactly the query shape GraphQL is infamous for. `loaders.ts` holds per-request DataLoaders (`driverById`, `teamById`, `assignmentById`) so that resolves in a bounded number of queries. Getting this wrong and then fixing it is worth more than reading about it.

**Where the replay payload travels.** The race page is a server component: it runs the `RaceReplayFragment` query through `execute.ts` and hands the result to the client player as a prop. The payload arrives inside the streamed HTML, so there is no fetch waterfall, and it is covered by the ISR cache like the rest of the page. `urql` is for genuinely interactive surfaces only — race library filters, standings toggles, admin forms.

**Hardening.** `/api/graphql` is public and unauthenticated, and an open schema is an open invitation: `race → meeting → races → meeting` nests forever, and a ~1200-row replay is a cheap thing to request in a loop. Two envelop plugins, always on — a depth limit (~10) and a cost limit — plus **introspection and GraphiQL enabled in development only**. That closes the cyclic-query and giant-payload classes in about fifteen lines while leaving ad-hoc querying available where it is actually useful.

**Auth in context.** The Yoga context factory reads the Auth.js session; admin fields check it in the resolver, not at the route level. Public queries need no session.

**Codegen.** `codegen.ts` generates TypeScript types from the schema plus typed hooks from `operations/*.graphql`. Runs in CI — a resolver change that breaks a client query fails the build rather than production.

**Not GraphQL:** ingest and cron. They are batch writers against Drizzle directly. Wrapping a 1200-row import in mutations would be pure ceremony.

---

## Data model

A **meeting** is a race weekend (Brazil 2025). A **race** is a scored session within it (the grand prix, or the sprint). v1 conflated the two: it kept `unique(seasonId, round)` *and* `unique(openf1SessionKey)` on the same table, which a sprint weekend cannot satisfy. Splitting them also gives meeting-level data (circuit, weather, weekend dates) one home instead of duplicating it per session.

```text
seasons ──< meetings ──< races ──< race_positions
   │                       │    ──< race_events
   │                       │    ──< race_results
   └──< team_seasons ──< driver_team_assignments >── drivers
             │
           teams
```

### `src/db/schema.ts`

```ts
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
export const ingestStatus  = pgEnum('ingest_status', ['RUNNING', 'SUCCESS', 'FAILED']);

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
```

### Relations (for the Drizzle query API and Pothos type mapping)

```ts
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

export const driverTeamAssignmentsRelations = relations(driverTeamAssignments, ({ one }) => ({
  driver: one(drivers, { fields: [driverTeamAssignments.driverId], references: [drivers.id] }),
  teamSeason: one(teamSeasons, { fields: [driverTeamAssignments.teamSeasonId], references: [teamSeasons.id] }),
}));
// …one block per table with a foreign key.
```

### Design notes

- **`assignmentId` everywhere, not `driverId`.** A position row points at a driver-in-a-team-in-a-season, so the replay knows the car's colour without a second lookup and historical liveries stay correct. v1 carried *both* `driverId` and `driverAssignmentId` on positions and events — two sources of truth for the same fact. Dropped.
- **Enums instead of free-text `type`.** v1's `race_events.type` was `String`, so typos were silent. A Postgres enum makes an unknown event type a migration, not a rendering bug.
- **`race_results` is new.** DNF/DNS/DSQ has a real home instead of being inferred from missing position rows. The replay's retirement handling and, later, strategist scoring both read it.
- **`slug` is stored, not derived.** Generated once at ingest (`2025-sao-paulo-sprint`), so URLs never shift when a name is edited.
- **Natural key on `seasons`.** `season_year` reads better than a uuid join and the year is genuinely unique and stable.
- **`weather` stays `jsonb`.** It is an upstream shape we render but never query into. Normalizing it would be work with no payoff.
- **Standings are derived, not stored.** `race_results` already carries points, status, and fastest lap per driver-race, so a stored snapshot would be a second source of truth for numbers we already own — and it would be the *upstream's* truth, diverging silently from our own the moment an ingest went wrong. Standings become an aggregate over `race_results` joined through `driver_team_assignments`, which also makes them a real GraphQL type instead of an opaque blob.
  **The consequence is that sprint points and post-race penalties are ours to get right.** That is why `race_results.points` is written verbatim from OpenF1 `/session_result` rather than computed from finishing position: the sprint scale, the fastest-lap point, and any stewards' adjustment are already baked into what upstream reports. We sum; we do not score.
- **Migrations only.** `drizzle-kit generate` produces SQL, it gets committed and reviewed like code. Never `drizzle-kit pull` — that round-trip is exactly how v1's schema got mangled.

## Ingest pipeline

The highest-risk part of v1 was `race-import.service.ts` — ~1100 lines, untested, and the only way data entered the system. Rebuild it as small pure pieces:

```
lib/ingest/openf1.ts      fetch + zod-validate raw OpenF1 responses, rate-limited
                          /sessions /meetings /drivers /laps /position
                          /pit /race_control /session_result /weather
lib/ingest/images.ts      download headshots/logos once, put() to Vercel Blob
lib/ingest/transform.ts   pure: raw payload -> rows. No I/O. This is what gets tested.
lib/ingest/run.ts         orchestrate: fetch -> transform -> upsert in a tx -> record ingest_run
```

**Running order comes from `/position`, not from lap times.** v1 derived it by summing
`lap_duration` per driver and sorting by the cumulative total, so a retiring driver simply
vanished from later laps and safety-car and red-flag periods reordered the field. v2 takes
order from `/position`, lap and sector times from `/laps`, pit stops from `/pit`, flags
from `/race_control`, and final classification from `/session_result`.

`/position` is a timestamped sample stream rather than per-lap rows, so the transform
joins the two: for each driver-lap, take the last `/position` sample with
`date <= lap.date_start + lap_duration`. That join is the most test-worthy function in the
pipeline — it is where lap numbering, retirements, and red-flag gaps all land.

### Rate limits

OpenF1's free tier serves **historical data from 2023 onward** at **3 requests/second and
30 requests/minute**. Its paid tier covers only the live window — from 30 minutes before a
session to 30 minutes after — which a Monday-morning ingest never touches, so the free tier
is the right tier permanently, not a starting point.

Those ceilings are low enough to matter for a backfill and irrelevant for a cron run. A full
2025 season is roughly 24 meetings × ~8 endpoints ≈ 200 requests, so `scripts/backfill.ts`
sequences its fetches with a delay that keeps it under 30/min and finishes in minutes. The
throttle lives in `lib/ingest/openf1.ts`, so the cron path inherits it for free rather than
each caller remembering. A 429 or 5xx retries with backoff; if it still fails, the run is
recorded `FAILED` in `ingest_runs` with the error — never swallowed.

Two entry points, same core:
- `POST /api/cron/ingest` — Vercel Cron, guarded by `CRON_SECRET` header. Picks up the next new/incomplete race, then revalidates the affected cache tags.
- `scripts/backfill.ts` — run locally or via GitHub Actions for a full historical season. No serverless timeout.

**Timeout constraint:** one race is ~20 drivers × ~60 laps ≈ 1200+ position rows plus events. That must not be one function invocation on Vercel's free tier. The cron handler processes **one race per invocation** and returns; multi-race work goes through `scripts/backfill.ts`. Idempotency comes from the unique constraints above — re-running an import must upsert, never duplicate.

Everything is written to Postgres. **No page ever fetches an external API at request time.**

---

## Auth

`src/auth.ts` — Auth.js v5, credentials provider, one admin looked up by email, bcrypt compare. JWT session strategy (no session table). `middleware.ts` matches `/admin/:path*` and redirects unauthenticated requests to `/login`. Public routes have no auth code at all.

Admin user is created by a seed script reading `ADMIN_EMAIL` / `ADMIN_PASSWORD` from env and hashing at write time. **No credential defaults anywhere in the source** — the v1 `admin`/`admin123` fallback is the exact mistake being designed out.

---

## Milestones

**M0 — Foundation.** New repo, Next.js + TypeScript + Tailwind, Neon project, Drizzle configured, schema written by hand, first migration generated and applied, seed script for seasons/teams/drivers. Vercel connected, preview deploys working. *Done when: `pnpm dev` runs against Neon and a seeded driver renders on a page.*

**M1 — Ingest.** `lib/ingest/*` with transform unit-tested against saved OpenF1 fixtures. `scripts/backfill.ts` imports the full 2025 season. `ingest_runs` records every attempt. *Done when: every 2025 meeting and its sessions (grand prix + sprints) are in the DB with correct per-lap positions and final classifications; the backfill completes a full season in one run without tripping the 30 req/min ceiling; and re-running it changes no row counts.*

A full season means the edge cases arrive in M1 rather than ambushing M2 — **sprint weekends** (two scored sessions per meeting), **red-flagged races** (lap numbering gaps), **DNS/DNF** drivers, mid-season driver swaps (the `driver_team_assignments` model already handles these), and races with fewer classified finishers than starters. Build the fixture set from the races that actually broke, and keep them as regression tests.

**M1.5 — GraphQL layer.** Pothos builder, `Race`/`Driver`/`Team`/`Season`/`RacePosition`/`RaceEvent` types, `races`/`race`/`seasons` queries with cursor pagination, Yoga mounted at `/api/graphql`, `execute.ts` for server components, DataLoaders, codegen wired. GraphiQL and introspection enabled in dev only, depth and cost limits on in every environment. Resolver tests run against PGlite. *Done when: the same query returns identical data through GraphiQL and through a server component, and loading a race issues a bounded number of SQL queries — verified in the Neon query log, not assumed.*

**M2 — Public replay.** Port `race-visualization/*` from `origin/dev` (canvas, player, controls, replay-state, race-car, live-timing-tower, circuit-info-panel, race-story-panel), `components/ui/*`, and `lib/circuit-data.ts`.

**The rendering code ports near-verbatim; the data contract does not.** v1 threaded race data down through props across seven components. v2 defines one GraphQL fragment — `RaceReplayFragment` — that the race page requests and the player consumes as a single typed object. Rewrite the component signatures to take that shape; leave the SVG, animation, and layout logic alone. This is the seam where v1 was weakest and the animation work was strongest, so it is the only part worth re-cutting.

Race library with search/filter, race detail page, server components reading through `execute.ts`, interactive parts through urql. Pages are ISR-cached and revalidated by tag from the ingest job.

*Done when: a race replays end to end at portfolio quality — and does so at 390px width, with the player controls operable by keyboard alone, and the timing tower reachable as the canvas's text alternative.* Mobile and keyboard access are acceptance criteria here rather than M4 polish because they are cheap to design in and expensive to retrofit into layout and event handling — and a phone is the state most people will first open this in.

**M3 — Admin + cron.** Auth.js, middleware guard, GraphQL mutations (`triggerIngest`, `setRaceFeatured`, `updateRaceMetadata`) with session checked in resolver context. Admin pages: race list, trigger/re-run import, view `ingest_runs`, toggle featured, edit metadata. `POST /api/cron/ingest` wired to `vercel.json` schedule. *Deliberately thinner than v1* — cron does the bulk work, so full CRUD over every driver/team/position row is not rebuilt.

**M4 — Polish + ship.** Standings page reading the derived `driverStandings`/`constructorStandings` resolvers (port `standings-view.tsx` and `wikipedia-image.tsx` from `origin/dev`), SEO (sitemap, robots, per-race OG images — port from v1), loading skeletons, dark theme, error boundaries. Image attribution line on `/about` — headshots originate from Wikipedia (CC BY-SA) and OpenF1. Custom domain.

**Deferred (post-v2):** public accounts (Auth.js OAuth providers + `users` table growth), Armchair Strategist (`predictions`/`race_scores`, stint builder, scoring, leaderboard — **built, not ported**: no strategist code survives on any archived v1 branch, only the orphaned `Prediction`/`RaceScore` Prisma models on `dev`). Both slot into the existing schema as new types and mutations rather than new endpoints — a good demonstration of why the GraphQL layer was worth building.

---

## Quality gates — the ones v1 never had

- `pnpm typecheck && pnpm lint && pnpm test` on every PR via GitHub Actions. Branch protection on `main`.
- Vitest on `lib/ingest/transform.ts` (pure by design, needs no DB) and on the GraphQL schema via `execute()` against **PGlite** — real Postgres compiled to WASM, running in-process. Migrations apply to a fresh instance per suite, so CI needs no Docker service and no network, and tests stay hermetic.
- **Migrations run from `.github/workflows/migrate.yml` on merge to `main`**, after CI passes and independently of the Vercel deploy. Not from the build command: preview builds would migrate production, and concurrent builds would race on the same database.
- `graphql-codegen --check` in CI: a resolver change that breaks a client operation fails the build.
- One Playwright smoke test: load a race page, press play, assert positions changed. No Sentry — Vercel logs plus the `ingest_runs` table cover the failure modes that matter (a silent cron failure is visible as a stale `ingest_runs` row).
- `.gitignore` covers `*.db`, `temp*`, `*.local`. No stray scripts at repo root — utilities live in `scripts/` or don't get committed.
- Branch flow: `feature/*` → `main`. No `dev`/`preprod`/`change` chain. Vercel preview deploys make a staging branch unnecessary at this scale.

---

## Verification

1. **DB:** `pnpm drizzle-kit generate` produces no diff against a clean checkout — proves schema and migrations agree, the exact check v1 failed.
2. **Ingest:** run `scripts/backfill.ts <sessionKey>` twice; row counts identical after the second run (idempotency). `ingest_runs` shows two `success` rows.
3. **GraphQL:** open `/api/graphql` in dev, run the race query in GraphiQL, compare to what the server component renders — identical. Watch the Neon query log while loading one race: query count must be bounded (roughly one per entity type), not proportional to driver count. Unbounded count means DataLoader is not wired.
4. **Replay:** `pnpm dev`, open `/races/[slug]`, play through — positions animate, timing tower matches the canvas order, events fire on the right lap.
5. **Auth:** hit `/admin` logged out → redirected to `/login`. Log in with seeded credentials → admin loads. `grep -ri "admin123\|password.*??" src/` returns nothing.
6. **Cron:** `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/ingest` succeeds; same call without the header returns 401.
7. **Caching:** load a race page twice on a deployed build. The second response is an ISR cache hit (`x-vercel-cache: HIT`) and the Neon query log shows no query for it. Then trigger an ingest and confirm the page reflects the new data on the next load.
8. **Standings:** after the full 2025 backfill, the derived driver and constructor tables match the published final championship standings. A one-time manual check, and the strongest end-to-end proof the ingest is correct — it exercises points, sprints, and classification in one number per driver.
9. **GraphQL hardening:** an introspection query against production returns an error; the same query in dev succeeds. A deliberately over-nested query is rejected by the depth limit.
10. **Deploy:** push a branch, preview URL builds and serves a working replay.

---

## Open questions for later (not blocking M0)

- Nothing blocking. Custom domain deferred — ships on `*.vercel.app`.

## Working agreement

- **M1.5 (GraphQL) is implemented by hand, not generated.** The schema design and DataLoader shape are specified here; writing the resolvers is the point of the milestone.
- Design decisions get recorded in [`decisions.md`](decisions.md) before they get implemented.
