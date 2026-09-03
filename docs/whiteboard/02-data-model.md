# 02 · Data Model

> **Where you are:** document 00 covered the principles, 01 the shape of the whole system. This one goes down to the columns. It is the document to keep open while writing `src/db/schema.ts`.

A data model is not a list of tables. It is a set of **claims about the world**, written in a language that can refuse to store a lie. Every constraint below exists because there is a false statement it makes unrepresentable. That is the lens for reading this document: for each table, ask *what does this stop me from writing?*

---

## Part 1 — The central distinction: meeting vs race

### The domain fact

A **meeting** is a race weekend. "São Paulo Grand Prix 2025" — one circuit, one country, one set of weather, one round number in the season.

A **race** is a *scored session* inside that weekend. On a normal weekend there is one: the grand prix. On a sprint weekend there are two: the sprint on Saturday and the grand prix on Sunday. Both award points. Both have their own lap-by-lap running order. Both have their own final classification.

### How v1 got this wrong

v1 had a single `races` table carrying both meanings, with two unique constraints on it:

```
unique(seasonId, round)          -- "one race per round"
unique(openf1SessionKey)         -- "one race per upstream session"
```

Read those together on a sprint weekend. Brazil is round 21. The sprint and the grand prix are two different OpenF1 sessions, so the second constraint says they must be two rows. The first constraint says round 21 may only have one row. **The two constraints are jointly unsatisfiable for a sprint weekend.** No amount of application code fixes that; the schema itself is contradictory.

This is the single most instructive bug in the v1 post-mortem, because it was not a coding error. It was a modelling error — one concept, two meanings, one table — and the constraints were the thing that eventually shouted about it.

### The v2 shape

```
seasons ──< meetings ──< races ──< race_positions
   │                       │    ──< race_events
   │                       │    ──< race_results
   └──< team_seasons ──< driver_team_assignments >── drivers
             │
           teams
```

Split into two tables, each constraint lands on the table where it is actually true:

| Table | Unique constraint | The claim it makes |
|---|---|---|
| `meetings` | `(season_year, round)` | A season has exactly one round 21. |
| `meetings` | `openf1_meeting_key` | We import each upstream weekend once. |
| `races` | `(meeting_id, type)` | A weekend has at most one sprint and one grand prix. |
| `races` | `openf1_session_key` | We import each upstream session once. |
| `races` | `slug` | Every race has one stable URL. |

All five are simultaneously satisfiable, and together they say something true and complete. `races_meeting_type_uq` in particular is the whole sprint problem solved in one line — it permits exactly two rows per meeting, and only if they are of different types.

### The second payoff

Circuit name, country, weather, and weekend dates belong to the *weekend*, not to each session. With one table they would be duplicated across the sprint row and the grand prix row, and duplicated data is data that can disagree with itself. With `meetings` they have one home. This is [single source of truth] applied at the schema level — the same principle that later kills the standings snapshot.

---

## Part 2 — Reference data: seasons, teams, drivers

### `seasons` — a natural key on purpose

```ts
export const seasons = pgTable('seasons', {
  year: integer('year').primaryKey(),
});
```

One column. The primary key *is* the year.

The reflex from most ORM tutorials is `id uuid` on everything. Resist it here. A season's year is genuinely unique, genuinely stable (2025 will not be renamed), and genuinely meaningful. Using it as the key means:

- `meetings.season_year = 2025` is readable in a raw SQL console with no join.
- Filtering races by season needs no join to `seasons` at all — the year is already denormalised into every child row by virtue of being the key.
- One less table to load in a resolver.

**When a natural key is the wrong choice:** when the value can change (a team's name), when it is not guaranteed unique (a driver's surname), or when it is externally controlled and might be reissued. A year is none of those.

### `teams` and `drivers`

```ts
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  color: text('color'),                  // hex, drives the replay palette
  logoUrl: text('logo_url'),             // our Vercel Blob URL, not upstream
  createdAt, updatedAt,
});

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(), // VER, HAM
  name: text('name').notNull(),
  number: integer('number'),
  country: text('country'),
  headshotUrl: text('headshot_url'),     // our Vercel Blob URL
  createdAt, updatedAt,
});
```

Two things worth noticing.

**`code` is unique, `name` is not.** The three-letter code is the identifier the sport itself treats as unique within a season, and it is what OpenF1 keys drivers by in practice. Names are display text.

**Both URL columns point at our own storage.** `headshotUrl` is not a Wikipedia URL. The ingest downloads the image once and `put()`s it to Vercel Blob, and this column stores the URL that comes back. The database therefore contains no dependency on an external host staying up, and `next/image` optimization can be left on because the origin is ours. v1 had to disable optimization entirely because it hotlinked unstable remotes. See document 03 for the fetch-once logic.

**`number` and `country` are nullable.** Not every driver in every historical import has them. A nullable column is an honest statement that the fact may be unknown; a `NOT NULL DEFAULT ''` would be a lie dressed as tidiness.

---

## Part 3 — The lineup model, and why `assignmentId` is everywhere

This is the part of the schema most worth understanding, because it looks like over-engineering until you see the query it makes possible.

### The problem

Drivers move between teams. Hamilton drove for Mercedes in 2024 and Ferrari in 2025. Teams change livery colour between seasons. A replay of the 2024 Brazilian Grand Prix must draw Hamilton's car in Mercedes silver even though the `teams` and `drivers` rows have since been updated.

So "which team was this driver in?" is not a fact about a driver. It is a fact about **a driver, a team, and a season together**.

### The two joining tables

```ts
// A team fields a lineup per season.
export const teamSeasons = pgTable('team_seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonYear: integer('season_year').notNull().references(() => seasons.year),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  color: text('color'),                  // per-season livery
}, (t) => [uniqueIndex('team_seasons_season_team_uq').on(t.seasonYear, t.teamId)]);

// A driver occupies a seat in that lineup.
export const driverTeamAssignments = pgTable('driver_team_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamSeasonId: uuid('team_season_id').notNull()
    .references(() => teamSeasons.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
}, (t) => [uniqueIndex('dta_team_season_driver_uq').on(t.teamSeasonId, t.driverId)]);
```

Read the chain: an **assignment** identifies *this driver, in this team, in this season*. One row. One uuid.

### The consequence: one foreign key instead of three

Every row of race data — positions, events, results — points at an `assignmentId`. Not at a `driverId`. Not at a `driverId` plus a `teamId` plus a season.

```ts
racePositions.assignmentId  →  driver_team_assignments
raceEvents.assignmentId     →  driver_team_assignments  (nullable: race-wide events)
raceResults.assignmentId    →  driver_team_assignments
```

That single reference resolves to driver, team, and season-correct livery colour by following relations that are already there. The replay needs a car's colour: `assignment → teamSeason → (color ?? team.color)`. Nothing has to be passed down or looked up twice.

### Per-season colour with a fallback

`teamSeasons.color` is nullable and `teams.color` is not the same column. The rule is:

```
displayColour = teamSeason.color ?? team.color
```

The season row wins when it has an opinion; the team's current colour is the fallback. That gives per-season liveries without demanding that every historical season be filled in before anything renders — a partially-populated table degrades to "current colours", which is wrong but harmless, rather than to a crash or a blank.

### How v1 got this wrong

v1's position and event rows carried **both** `driverId` and `driverAssignmentId`.

Two columns, one fact. Nothing in the schema forced them to agree. `positions.driverId` could say Hamilton while `positions.driverAssignmentId` resolved to Russell's seat, and the database would accept it happily. Which one the code read then depended on which query the developer wrote that afternoon — the classic symptom of a duplicated source of truth.

v2 drops `driverId` from every race-data table. There is exactly one path from a position row to a driver, so there is exactly one answer.

**The cost, stated honestly:** "all results for driver X across all seasons" now needs a join through `driver_team_assignments` rather than a direct `WHERE driver_id = ?`. That is one extra join in a handful of queries, paid so that the far more common per-race read is both cheaper and unambiguous.

---

## Part 4 — Race data: the replay payload

### `race_positions` — the heart of the system

```ts
export const racePositions = pgTable('race_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  lap: integer('lap').notNull(),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  position: integer('position').notNull(),
  gap: text('gap'),                      // "+1.234" or "LAP 1" — upstream is a string
  lapTime: real('lap_time'),
  sector1: real('sector_1'),
  sector2: real('sector_2'),
  sector3: real('sector_3'),
}, (t) => [
  uniqueIndex('race_positions_lap_driver_uq').on(t.raceId, t.lap, t.assignmentId),
  uniqueIndex('race_positions_lap_position_uq').on(t.raceId, t.lap, t.position),
  index('race_positions_race_lap_idx').on(t.raceId, t.lap),
]);
```

One row per driver per lap. About **20 drivers × 60 laps ≈ 1,200 rows per race**. That number sets the shape of nearly everything downstream: the GraphQL payload design in 04, the N+1 discussion, the decision to keep the whole replay in one server-rendered prop.

**The two unique constraints are the interesting part**, and they say different things:

| Constraint | The claim | What it makes impossible |
|---|---|---|
| `(race_id, lap, assignment_id)` | A driver holds one position per lap. | A driver appearing twice on lap 30. |
| `(race_id, lap, position)` | A position is held by one driver per lap. | Two cars both classified P3 on lap 30. |

Together they assert that each lap is a **bijection** between drivers and positions — a genuine running order, not a bag of guesses. A transform bug that duplicates or drops a driver hits one of these two constraints and the ingest transaction aborts. **The database is a test that runs in production.**

This matters because the failure it catches is exactly v1's failure. v1 derived running order by summing lap times (see document 03), which could and did produce two drivers in the same position. With no constraint, that wrote cleanly and surfaced later as a visual glitch in the replay that nobody could trace back to the import.

**`gap` is `text`, not a number.** Upstream sends `"+1.234"` for a gap in seconds and `"LAP 1"` for a driver a lap down. Those are not the same type of thing, and forcing them into a float means either losing the lapped case or inventing a sentinel. We render the string; we never compute with it. Storing what upstream actually said is the honest option.

**`lapTime` and the sectors are nullable** because an out-lap, an in-lap, or a red-flagged lap may have no valid time.

### `race_events`

```ts
export const raceEvents = pgTable('race_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  lap: integer('lap').notNull(),
  assignmentId: uuid('assignment_id')
    .references(() => driverTeamAssignments.id),   // null = race-wide
  type: eventType('type').notNull(),
  details: text('details').notNull(),
}, (t) => [index('race_events_race_lap_idx').on(t.raceId, t.lap)]);
```

**`assignmentId` is nullable here and only here.** That nullability carries meaning: a pit stop belongs to a driver, a safety car belongs to the race. Rather than inventing a fake "race" driver row, the absence of a driver *is* the encoding of "this applies to everyone". The nullable column is doing real modelling work.

**`type` is a Postgres enum, not `text`:**

```ts
export const eventType = pgEnum('event_type', [
  'OVERTAKE', 'PIT_STOP', 'RETIREMENT', 'SAFETY_CAR', 'VIRTUAL_SAFETY_CAR',
  'RED_FLAG', 'FASTEST_LAP', 'PENALTY', 'OTHER',
]);
```

v1 typed this as `String`. `'SAFTEY_CAR'` inserted without complaint and simply never matched the renderer's switch — a typo became a silently missing feature. With an enum, the same typo is a **write-time error** in the ingest, and adding a genuinely new event type becomes a migration: a deliberate, reviewed act rather than a string appearing in a file.

This is the Open-Closed Principle showing up as a DDL statement. The renderer is closed against arbitrary strings and open to extension through a migration.

### `race_results` — the table v1 never had

```ts
export const raceResults = pgTable('race_results', {
  raceId: uuid('race_id').notNull().references(() => races.id, { onDelete: 'cascade' }),
  assignmentId: uuid('assignment_id').notNull().references(() => driverTeamAssignments.id),
  gridPosition: integer('grid_position'),
  finalPosition: integer('final_position'),   // null when not classified
  status: driverStatus('status').notNull(),   // FINISHED | DNF | DNS | DSQ
  lapsCompleted: integer('laps_completed').notNull().default(0),
  points: real('points').notNull().default(0),
  fastestLap: boolean('fastest_lap').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.raceId, t.assignmentId] })]);
```

**Note the composite primary key.** No surrogate `id`. The pair *(race, driver-assignment)* already identifies a result uniquely, and a surrogate key here would add a column that no query ever uses while permitting a duplicate result row for the same driver. The natural key is both smaller and stricter.

**Why the table exists at all.** v1 had nowhere to record that a driver retired. It inferred DNFs from the *absence* of position rows on later laps — which cannot distinguish "retired on lap 30" from "the import dropped lap 31 onward for this driver". Absence of data was overloaded to mean a fact about the world, and there is no way to tell a real retirement from a broken import in that encoding.

`status` makes it explicit. `finalPosition` is nullable precisely because a non-classified driver has no finishing position — again, `NULL` as an honest "no such fact" rather than a `0` or a `99` sentinel.

**`points` is written verbatim from upstream, never computed.** This is a deliberate and slightly counter-intuitive choice, and it is the load-bearing one for the whole standings design in Part 5.

The temptation is to compute points from `finalPosition` with a lookup table (25, 18, 15, …). Do not, because the real number depends on:

- **which session it is** — sprints use a different, shorter scale (8, 7, 6, …);
- **the fastest-lap point**, in the seasons where it applies and only within the top ten;
- **stewards' penalties applied after the flag**, which change classification and points hours after the race;
- **half points**, in a race stopped early.

OpenF1's `/session_result` already reflects all of it. Recomputing means reimplementing four rules that change between seasons and getting them subtly wrong. Copying means being exactly as right as the source.

> **We sum; we do not score.**

That single sentence is the contract for everything downstream. `race_results.points` is the atom; standings are a `SUM()` over atoms. No scoring logic exists anywhere in the codebase.

---

## Part 5 — Standings: the table that was deleted

An earlier draft of this schema had a `standings_snapshots` table with a `standings_type` enum, holding a computed championship table per season. **It was removed**, and the reasoning generalises well beyond this project.

### The argument for deleting it

`race_results` already holds, per driver per race: points, status, finishing position, fastest lap. A championship table is nothing more than:

```sql
SELECT assignment.driver_id,
       SUM(r.points)                                    AS points,
       COUNT(*) FILTER (WHERE r.final_position = 1)     AS wins,
       COUNT(*) FILTER (WHERE r.final_position <= 3)    AS podiums
FROM race_results r
JOIN driver_team_assignments assignment ON assignment.id = r.assignment_id
JOIN races  ON races.id = r.race_id
JOIN meetings ON meetings.id = races.meeting_id
WHERE meetings.season_year = $1
GROUP BY assignment.driver_id
ORDER BY points DESC;
```

A snapshot table would be a **second source of truth for numbers we already own**. The two can disagree. When they do — a re-ingest corrects a result but the snapshot is not rebuilt — the site shows a standings table that contradicts its own race pages, and nothing in the system notices.

Worse, the snapshot would have been populated from a *second upstream API* (Jolpica/Ergast). So the site would have shown the upstream's championship table beside our own race results, and any divergence between them would have been invisible rather than loud. The value of deriving is precisely that **a bug in the ingest shows up in the standings**, which is why Verification step 8 — compare the derived 2025 table against the published final championship — is the strongest end-to-end test in the whole project. One number per driver exercises points, sprints, penalties, and classification simultaneously.

### The knock-on effect

Once standings were derived, the second upstream API had no remaining job. It was dropped entirely, leaving **OpenF1 as the only data source**. One client, one rate limit, one failure mode, one set of fixtures. The accepted cost: OpenF1's historical coverage starts at 2023, so no earlier season can ever be imported. Given that the scope is 2025 onward, that cost is real but never paid.

**The general lesson:** deleting a table removed an entire external dependency. Data model decisions are not local.

### `position` is a rank, not a column

Notice what the GraphQL type does with this:

```graphql
type DriverStanding {
  position: Int!  driver: Driver!  team: Team!
  points: Float!  wins: Int!  podiums: Int!
}
```

`position` here is the row's index in the ordered result — computed at query time from the ordering, never stored. Storing a rank is storing a *conclusion*; the moment any input changes, the stored conclusion is stale and nothing forces it to be recomputed.

---

## Part 6 — Operations tables

### `ingest_runs` — the observability strategy, in one table

```ts
export const ingestRuns = pgTable('ingest_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),      // 'openf1' | 'images'
  target: text('target'),                // race slug or season
  status: ingestStatus('status').notNull(),  // RUNNING | SUCCESS | FAILED
  rowsWritten: integer('rows_written').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [index('ingest_runs_started_idx').on(t.startedAt)]);
```

This table is the reason the project runs **no Sentry and no external monitoring**. The failure mode that actually matters here is not an exception in a page render — it is *a cron job that quietly stopped working three weeks ago*. That failure is silent by nature: nothing errors, no user complains, the site just gradually goes stale.

A row per attempt makes it loud. The admin panel shows the most recent runs; a `FAILED` row carries its error text, and — more importantly — **the absence of a recent `SUCCESS` row is itself the alert**. A `RUNNING` row that never got a `finishedAt` means the function was killed mid-flight.

`status` is an enum for the same reason `event_type` is.

### `app_config` — one row, enforced by the database

```ts
export const appConfig = pgTable('app_config', {
  id: integer('id').primaryKey().default(1),
  ingestEnabled: boolean('ingest_enabled').notNull().default(true),
  runDays: text('run_days').array().notNull().default(['mon']),
  activeSeason: integer('active_season').notNull(),
  hoursAfterRace: integer('hours_after_race').notNull().default(12),
}, (t) => [check('app_config_single_row', sql`${t.id} = 1`)]);
```

The `CHECK (id = 1)` is the whole point. A settings table that can hold two rows is a table where "which one is the real config?" becomes a question the application has to answer, usually with `ORDER BY id LIMIT 1` and a shrug. The check constraint makes a second row a **write error**, so `SELECT * FROM app_config` is unambiguous by construction.

This is the Singleton pattern implemented where it actually holds — in the database, enforced — rather than as a module-level variable that a second process cheerfully duplicates.

Why this table exists at all: Vercel Cron schedules live in `vercel.json` and are static, so changing the cadence would mean a redeploy. Instead the schedule is deliberately dumb (fire daily) and the **handler** is smart (read config, decide whether work is due). Cadence becomes data, editable from the admin panel. Document 03 covers the handler logic; document 05 covers why the Hobby plan's once-per-day ceiling makes this the only workable shape.

### `users`

```ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

One row in practice. The column is `passwordHash` and there is no `password` column anywhere — the name of the column is itself a piece of documentation. Seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars, hashed at write time.

**No credential default exists anywhere in the source.** v1 shipped `process.env.ADMIN_PASSWORD ?? 'admin123'` on a branch, which is a backdoor that a missing environment variable silently opens. The `??` is the bug, not the string. See document 05.

---

## Part 7 — Two columns that stayed `jsonb`, and why that is consistent

`meetings.weather` is `jsonb`. Standings were deleted for being derived data. Those two decisions can look contradictory — one keeps an unstructured blob, the other refuses to store a computed table — so it is worth naming the rule that produces both.

**The rule: normalise what you query, keep verbatim what you only render.**

| | `weather` | standings |
|---|---|---|
| Do we filter or aggregate on it? | Never | Constantly |
| Does it need to join to anything? | No | Driver, team, season |
| Is it derived from data we own? | No — upstream observation | Yes — entirely |
| Verdict | `jsonb`, stored as-is | Not stored; derived on read |

Normalising `weather` into columns would be schema work, migration work, and transform work, in exchange for query capability nobody wants. Storing standings buys a small read speedup in exchange for a second source of truth. Both decisions come from asking the same question and getting opposite answers, which is what a real rule looks like.

**The trap to avoid** is `jsonb` as a way to postpone modelling. If a query ever needs `WHERE weather->>'rainfall' = ...`, that is the signal the column has changed category and should be normalised. Until then it is a rendered blob.

---

## Part 8 — The invariants

This is what the data model is *for*. Each line below is a false statement about a Formula 1 season that this schema will refuse to store.

| # | Cannot happen | Enforced by |
|---|---|---|
| 1 | Two drivers in the same position on the same lap | `race_positions (race_id, lap, position)` unique |
| 2 | One driver in two positions on the same lap | `race_positions (race_id, lap, assignment_id)` unique |
| 3 | A season with two round 21s | `meetings (season_year, round)` unique |
| 4 | A weekend with two grands prix | `races (meeting_id, type)` unique |
| 5 | The same upstream session imported twice | `races.openf1_session_key` unique |
| 6 | The same upstream weekend imported twice | `meetings.openf1_meeting_key` unique |
| 7 | Two URLs for one race, or two races on one URL | `races.slug` unique |
| 8 | A driver assigned to the same team-season twice | `driver_team_assignments` unique |
| 9 | Two result rows for one driver in one race | `race_results` composite PK |
| 10 | An unrecognised event type or driver status | `pgEnum` on both columns |
| 11 | Two competing application configs | `CHECK (id = 1)` on `app_config` |
| 12 | Position rows surviving their deleted race | `ON DELETE CASCADE` |
| 13 | A position row pointing at a non-existent driver seat | Foreign key on `assignment_id` |

Read the table as a whole and something becomes clear: **invariants 1, 2, 5, 6, 8, and 9 are also the idempotency mechanism.** Re-running an ingest cannot duplicate anything, because the constraints make duplication impossible and the writes are `INSERT … ON CONFLICT DO UPDATE`. There is no separate "have I already imported this?" check to write, and therefore no such check to get wrong.

That is the payoff of taking constraints seriously. A property the application would otherwise have to *maintain* becomes a property the schema *guarantees*. The code that does not exist is the code that cannot break.

### What is deliberately not enforced

Honesty about the boundary matters as much as the invariants themselves. The schema does **not** guarantee:

- **That lap numbers are contiguous.** A red-flagged race can have gaps, and that is legitimate.
- **That every driver has a row on every lap.** A retirement means the rows simply stop. Invariant 1 still holds within each lap.
- **That points match finishing position.** By design — see Part 4. Upstream is the authority.
- **That positions on lap *n* relate sensibly to lap *n−1*.** No constraint spans laps; cross-lap plausibility is the transform's job, and the transform's tests are where it is checked.

The last one is the interesting boundary. Constraints catch *structural* nonsense cheaply. *Semantic* nonsense — a running order that is internally valid but describes a race that never happened — is caught by unit tests on `transform.ts` and by the standings cross-check in Verification. Knowing which mechanism catches which class of bug is the skill; expecting constraints to catch everything is how you end up with a schema too rigid to hold a red-flagged race.

---

## Migrations: the rule that has no exceptions

`src/db/schema.ts` is **hand-written and is the source of truth**. `drizzle-kit generate` reads it and produces SQL migrations, which are committed and reviewed like any other code.

**`drizzle-kit pull` is never run.** That command reads the live database and rewrites the schema file — the round-trip that mangled v1's Prisma schema and left it drifted from its own migrations, with models on `dev` that had no migration behind them at all. One direction only: schema file → migration → database. A round-trip is how a source of truth stops being one.

Verification step 1 is the check: `pnpm drizzle-kit generate` against a clean checkout must produce **no diff**. If it produces one, the schema and the migrations disagree, and that is precisely the v1 failure detected automatically instead of six months later.

---

**Next:** document 03 takes the ingest pipeline apart — how rows actually get into these tables, and the `/position` ↔ `/laps` join where the hardest bug in the project lives.
