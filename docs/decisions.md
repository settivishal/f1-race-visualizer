# Decision Log

Every architectural decision for v2, with the reasoning that produced it. Newest
decisions are appended at the bottom. A decision that gets reversed is not deleted —
it gets a follow-up entry saying what changed and why.

Format: what was decided, what else was considered, and why the alternative lost.

---

## 2026-09-02 — Abandon v1, start a new repository

**Decided:** archive `f1-race-visualizer` as `f1-race-visualizer-v1`, start fresh.

v1 was functional but carried compounding structural debt:

- Prisma schema drift — `Prediction` and `RaceScore` models existed in `schema.prisma`
  on `dev` with no corresponding migration
- The schema had been overwritten by `prisma db pull`, losing comments and generating
  relation names like `Prediction_Prediction_predictedWinnerDriverIdToDriver`
- A hardcoded `admin` / `admin123` login backdoor on `feature/supabase`, with no
  environment guard, that bypassed authentication entirely
- Committed junk: `temp.json`, `fix-lint.js`, `dev.db`, `test-db.js`, `check-races.ts`
- 20+ branches, three of them mutually divergent on how authentication worked

**Root cause:** auth, data flow, and deployment were never decided up front, so each
was rewritten under pressure — auth three times (cookies → Bearer tokens → Supabase).

Untangling this would have cost more than restarting with the design settled. v1 stays
archived and readable, and its working code is ported rather than rewritten.

---

## 2026-09-02 — Scope: replay, public site, standings, admin

**Decided:** v2 core is the replay engine, public site, standings, and
admin/ingestion. Public user accounts and the Armchair Strategist prediction game are
deferred, not cut.

Shipping the core product first means the foundation gets proven by something that
matters before it carries a social feature.

*(Corrected 2026-09-02, later the same day: this entry originally said both deferred
features were "already built in v1 (`origin/feature/user`)" and could be ported. The
archived repository has four branches — `main`, `dev`, `preprod`, `feature/supabase` —
and no prediction, stint, scoring, or leaderboard file on any of them. What survives is
the orphaned `Prediction`/`RaceScore` Prisma models on `dev`, which are the schema drift,
not an implementation. Public accounts port from the auth work on `feature/supabase`;
the strategist game gets built.)*

**Consequence:** the only account in v2 is the admin's. That collapses most of the
authentication surface — no signup, no email verification, no password reset flow.

---

## 2026-09-02 — Architecture: a single Next.js app

**Decided:** one Next.js application. No separate API service.

**Considered:** keeping v1's Next + NestJS split; adding tRPC.

v1's split forced CORS configuration, a custom `x-web-origin` header, and duplicated
token plumbing at every boundary — for one developer serving portfolio traffic. The
separation bought a seam that nothing consumed.

In a single app, server components query the database directly: the race page renders
with no HTTP hop at all. If a mobile client or public API ever needs the seam, the
GraphQL schema already is one.

---

## 2026-09-02 — Auth: Auth.js credentials, one admin

**Decided:** Auth.js v5 (NextAuth), credentials provider, JWT session strategy, a
single admin user seeded from environment variables.

**Considered:** Supabase Auth (already ported in v1), Clerk, no auth at all.

With no public accounts, a hosted identity provider would manage exactly one user.
Auth.js credentials is roughly 50 lines and replaces v1's entire auth module. When
public accounts return, Auth.js adds OAuth providers without a rewrite.

**Hard rule:** no credential defaults anywhere in source. v1's
`process.env.ADMIN_PASSWORD ?? 'admin123'` is precisely the pattern being designed out.
The admin is created by a seed script that reads env and hashes at write time.

---

## 2026-09-02 — Database: Neon Postgres + Drizzle

**Decided:** Neon for hosting, Drizzle as the ORM. Migrations are the only source of
truth.

**Considered:** Neon + Prisma (the known quantity), Supabase + Prisma, an always-on
instance on Railway or Fly.

v1's specific failure was schema drift caused by `prisma db pull` writing over a
hand-authored schema. Drizzle's schema is TypeScript that generates SQL migrations;
there is no round-trip that can silently overwrite the model. It is also lighter on
serverless cold starts.

**Hard rule:** never run `drizzle-kit pull`. Migrations are generated, committed, and
reviewed like code.

Neon's free tier and per-branch databases suit a portfolio project; database branching
pairs with Vercel preview deploys.

---

## 2026-09-02 — API: GraphQL (Yoga + Pothos), consumed by urql

**Decided:** GraphQL is the application's data layer. One schema serves all reads and
all admin mutations. Server components execute it in-process; client components POST to
`/api/graphql`.

**Honest framing:** this is a learning goal, not an architectural necessity — server
components could query Drizzle directly. It is made genuine by being *the* data layer
rather than a decorative veneer over three queries, so the parts worth learning are
unavoidable: schema design, resolver composition, DataLoader batching, pagination,
fragments, and typed codegen.

Pothos is code-first, so types are inferred from the Drizzle models and the schema
cannot drift from the database. Yoga runs inside a Next route handler; Apollo Server is
heavier and less at home there.

`race.positions → assignment → driver → team` across ~1200 rows per race is a textbook
N+1. Per-request DataLoaders keep it bounded, and verifying that in the query log is
part of the milestone's definition of done.

**Not GraphQL:** the ingest pipeline and cron handler. They are batch writers against
Drizzle. Wrapping a 1200-row import in mutations would be ceremony.

---

## 2026-09-02 — Data: scheduled ingest into our own database

**Decided:** a scheduled job pulls from OpenF1 and Ergast into Postgres. No external
API is called during a page request, ever.

**Considered:** live fetch with caching; a static seeded dataset; admin-triggered
imports only (v1's model).

v1 called `api.openf1.org` and `api.jolpi.ca` live on every relevant request with no
cache, inheriting their latency, uptime, and rate limits on every page load. Reading
only our own database makes the site fast, keeps it working when upstream is down, and
removes rate limiting as a failure mode.

**Seed data:** the full 2025 season. 2026 races arrive automatically as they run, which
makes the scheduled job genuinely load-bearing rather than decorative.

**Cadence:** cron fires daily at 06:00 UTC; the handler decides whether work is due,
reading an `app_config` row (enabled, run days, active season). The default targets
Monday morning, after Sunday races. Vercel cron schedules are static in `vercel.json`
and need a redeploy to change, so the schedule stays dumb and the handler stays smart —
cadence is editable from the admin panel with no deploy.

**Timeout:** one race is ~1200 position rows. The cron handler processes one race per
invocation; `scripts/backfill.ts` handles full seasons with no serverless limit.

---

## 2026-09-02 — Data model: meetings are separate from races

**Decided:** a `meeting` is a race weekend; a `race` is a scored session within it,
typed `GRAND_PRIX` or `SPRINT`.

**Considered:** one row per session with a relaxed constraint; ignoring sprints
entirely.

v1's `races` table carried both `unique(seasonId, round)` and `unique(openf1SessionKey)` —
constraints a sprint weekend cannot satisfy simultaneously, since one round has two
scored sessions. Splitting also gives weekend-level data (circuit, country, weather) a
single home instead of duplicating it across sessions.

Three further corrections to v1's schema:

- **`assignmentId` only, never a parallel `driverId`,** on positions and events. v1
  carried both — two sources of truth for one fact. A position points at a
  driver-in-a-team-in-a-season, so the replay gets the correct historical livery
  without a second lookup.
- **Postgres enums** for event type, race type, and driver status. v1's
  `race_events.type` was a free string, so a typo rendered nothing and failed silently.
- **A `race_results` table.** v1 had no home for final classification and inferred
  retirements from *missing* position rows. DNF/DNS/DSQ, grid position, and points now
  have a real place, which both the replay and future scoring read.

---

## 2026-09-02 — Replay engine: port the rendering, rebuild the data contract

**Decided:** port v1's replay components near-verbatim; replace how they receive data.

v1 threaded race data through props across seven components. v2 defines a single
GraphQL fragment the page requests and the player consumes as one typed object.

The SVG, animation, and layout work is the hardest-won code in v1 and is kept. The
prop plumbing is the weakest and is cut. Rebuilding the rendering from scratch would
mean redoing the part that already works.

Same reasoning for `components/ui/*` — v1's hand-rolled primitives already match the
F1 dark theme, so they port instead of pulling in shadcn/ui.

---

## 2026-09-02 — Images: downloaded at ingest into Vercel Blob

**Decided:** driver headshots and team logos are fetched once during ingest, stored in
Vercel Blob, and served from our own URLs.

v1 hotlinked Wikipedia and had to disable Next.js image optimization because the
sources were remote and unstable. Owning the files means optimization works, images
don't break when an upstream URL changes, and we aren't hotlinking someone else's
bandwidth. A failed image fetch falls back to a team-colour initials badge and never
blocks an ingest.

---

## 2026-09-02 — Deployment: Vercel, no custom domain yet

**Decided:** Vercel for the app and cron, Neon for the database, the default
`*.vercel.app` domain. GitHub Actions for lint, typecheck, and tests, and for long
backfills that would exceed a serverless timeout.

Branch flow is `feature/*` → `main`. No `dev` / `preprod` / `change` chain — v1 had
one, and it produced merge-order problems between diverging feature branches without
providing anything preview deploys don't already give.

---

## 2026-09-02 — Testing: where the bugs actually are

**Decided:** Vitest on the ingest transform layer and on GraphQL resolvers, plus one
Playwright smoke test. No Sentry.

The transform layer is written pure — raw payload in, rows out, no I/O — specifically
so it can be tested without a database. That is where correctness bugs live: sprint
weekends, red-flag lap numbering, drivers who don't finish.

Error tracking is deliberately skipped. Vercel logs plus the `ingest_runs` table cover
the failure mode that matters: a silent cron failure is visible as a stale row.

v1 had no tests at all beyond a scaffold spec file.

---

## 2026-09-02 — Naming after the restart: `f1-race-visualizer` everywhere

**Decided:** v2 owns the name `f1-race-visualizer`. The name `f1-visualizer` is retired.

The original repository was renamed to `f1-race-visualizer-v1` and archived, which freed
its old name; v2 then took it on GitHub (`settivishal/f1-race-visualizer`) and as the
local folder (`~/Coding/f1-race-visualizer`). Early drafts of this design used
`f1-visualizer` as a working name for the new project, which is now wrong in two
directions at once — it is neither the repository name nor the folder name, and reading
`f1-race-visualizer` as "the old one" is exactly the confusion the rename created.

One name, three places: GitHub repository, local folder, and `package.json`.

---

## 2026-09-02 — Team colour is per season, not per team

**Decided:** `team_seasons` gains a nullable `color`. `teams.color` stays as the current
default, and the replay resolves `teamSeason.color ?? team.color`.

**Considered:** keeping colour only on `teams`, as the first draft of the schema had it.

That draft contradicted its own reasoning. Positions point at an assignment — a
driver-in-a-team-in-a-season — and the stated reason was that "historical liveries stay
correct". They cannot, if the only colour on record is the team's present-day one: replay
a 2024 race after a livery change and every car is painted in this year's colour. v1
carried `TeamSeason.color` and was right to.

One nullable column now, against a migration plus a backfill later.

---

## 2026-09-02 — Running order comes from OpenF1 `/position`

**Decided:** per-lap running order is read from `/position`. `/laps` supplies lap and
sector times, `/pit` pit stops, `/race_control` flags, `/session_result` the final
classification.

**Considered:** porting v1's `buildPositionsFromLaps`, which is known-working code.

It is known-working and quietly wrong. It sums `lap_duration` per driver and sorts by the
cumulative total, which means a driver who retires stops producing lap rows and silently
disappears from the field rather than being classified as retired; and any period where
cars are not racing at their own pace — safety car, virtual safety car, red flag — reorders
the classification. v1 then patched the symptoms back in by regexing free text.

`/position` is a timestamped sample stream, not per-lap rows, so the transform joins it to
`/laps`: for each driver-lap, take the last sample with
`date <= lap.date_start + lap_duration`. That join carries the lap numbering, the
retirements, and the red-flag gaps, so it is the function the fixture tests are built
around.

**Cost:** four more endpoints per session and a larger fetch. The transform reduces to one
row per driver-lap before anything is written, so the row counts are unchanged.

---

## 2026-09-02 — The replay payload is one driver-centric GraphQL field

**Decided:** `Race.replay: RaceReplay!` returns `{summary, laps, drivers[].positions[],
events[]}` as a single object. The flat `positions(lap: Int)` field stays for the timing
tower's per-lap slice.

**Considered:** exposing only flat position rows and letting the client group them.

Reading v1's components changed this. The design assumed race data was threaded through
seven components as separate props; in fact all seven already take one object
(`visualization: RaceVisualization`), and the canvas, timing tower, and story panel each
index into `drivers[].positions[]` directly. A flat list would make the client re-pivot
~1200 rows on every render — worse than what it replaces.

So the fragment is shaped to match what the components already consume, and the port
becomes a type swap rather than a rewrite. The prop plumbing that genuinely was v1's
weak point — the explorer's nine `useState`s doing fetch, filter, and sort on the
client — still gets cut, into the `races` query.

---

## 2026-09-02 — Neon driver: `neon-serverless`, not `neon-http`

**Decided:** one client, `drizzle-orm/neon-serverless` (WebSocket `Pool`), shared by the
app and `scripts/backfill.ts`.

The HTTP driver is lighter and faster for one-shot reads, but it cannot hold a
multi-statement transaction — and ingest upserts a race, its positions, its events, and
its results as one unit or not at all. Splitting into an HTTP client for reads and a
WebSocket client for writes would buy a little latency for two connection paths to keep
straight.

---

## 2026-09-02 — The `app_config` single-row constraint lives in the schema

**Decided:** the CHECK that pins `app_config` to one row is declared in `schema.ts` with
Drizzle's `check()`, so `drizzle-kit generate` emits it.

The design originally said "enforced by a CHECK in migration" while also ruling that
migrations are generated and never hand-edited. Both cannot hold. Declaring the constraint
in the schema keeps the schema as the single source of truth, which is the whole reason
Drizzle was chosen over the Prisma setup that drifted in v1.

---

## 2026-09-03 — Standings are derived from `race_results`, not stored

**Decided:** standings are an aggregate query over `race_results`, exposed as
`driverStandings` and `constructorStandings`. The `standings_snapshots` table and the
`standings_type` enum are removed from the schema before either is written.

**Supersedes** the 2026-09-02 data-model entry, which kept a snapshot table alongside
`race_results`.

**Considered:** keeping the snapshot as the authority; computing and reconciling both.

The same entry that introduced `race_results` gave it points, status, and fastest lap per
driver-race — which is the entire input to a championship table. Keeping a snapshot as well
meant two sources of truth for one set of numbers, and the snapshot was the *upstream's*
truth: it would keep rendering correct-looking standings while our own ingest quietly
diverged behind it. Deriving removes the divergence by construction, drops a table and an
enum, and turns standings from an opaque `jsonb` blob into a real GraphQL type.

**Consequence, stated plainly:** sprint points and post-race penalties become ours to get
right. That is why `race_results.points` is written verbatim from OpenF1 `/session_result`
rather than computed from finishing position — the sprint scale, the fastest-lap point, and
any stewards' adjustment are already baked into what upstream reports. We sum; we do not
score. The verification step for M1 is that derived 2025 standings match the published final
championship table, which is also the strongest end-to-end check the ingest has.

---

## 2026-09-03 — Jolpica (Ergast) dropped; OpenF1 is the only upstream

**Decided:** the ingest pipeline talks to OpenF1 and to Wikipedia for images. Nothing else.
`lib/ingest/ergast.ts` is removed from the target structure before it is written.

**Supersedes** the two-source premise in the 2026-09-02 "scheduled ingest" entry.

**Considered:** keeping Jolpica as a silent reconciliation check against the derived
standings; keeping it to serve pre-2023 seasons.

With standings derived, Jolpica had no remaining job. OpenF1 `/session_result` already
returns final position, status, and points across the 2023-onward range that is the whole
scope of this project. A second client, a second rate limit, and a second failure mode were
buying a duplicate of data we already fetch.

Jolpica's own documentation states its unauthenticated limits (4 req/s burst, 500/hr
sustained) will *decrease* as token access rolls out — so the dependency was also the one
most likely to break unannounced.

**Cost, accepted:** no season before 2023 can ever be imported, since OpenF1 does not serve
them. That is not much of a loss — there is no replay data for those years either, so
keeping Jolpica would have bought standings tables with no races behind them. And no
official cross-check on points; the M1 manual comparison against the published championship
table covers that once, where it matters.

---

## 2026-09-03 — Rendering: ISR, revalidated by the ingest job

**Decided:** public pages are statically cached. A successful ingest calls
`revalidateTag('race')` and `revalidateTag('standings')` as its last step, after the
transaction commits.

**Considered:** fully dynamic rendering; time-based ISR (`revalidate = 3600`).

Race data changes once a week, so rendering it per request is waste — and on Neon's free
tier that waste has a visible cost, because an autosuspended database wakes up on the
visitor's page load. Caching means traffic never touches Postgres at all.

Time-based revalidation would have left a freshly ingested race up to an hour stale for no
reason: the ingest job knows precisely when the data changed, so it is the right thing to do
the invalidating. Revalidating only after the transaction commits means a failed ingest
leaves the cache serving the last good data rather than dropping it.

---

## 2026-09-03 — Migrations run from a GitHub Action on merge to `main`

**Decided:** `.github/workflows/migrate.yml` applies migrations against the production
database on merge to `main`, after CI passes and independently of the Vercel deploy.

**Considered:** `drizzle-kit migrate && next build` as the Vercel build command; running
them by hand before pushing.

Putting migrations in the build command means every preview deploy migrates production, and
concurrent builds race each other on the same database. Running them by hand works until the
first time it is forgotten — and the failure mode is a deployed app querying columns that do
not exist yet.

A dedicated job is explicit, auditable in the Actions log, cannot run twice concurrently,
and a failed migration fails loudly on its own instead of half-deploying an application.

---

## 2026-09-03 — GraphQL hardening: depth and cost limits, no production introspection

**Decided:** two envelop plugins on `/api/graphql` in every environment — a depth limit
(~10) and a cost limit. Introspection and GraphiQL are enabled in development only.

**Considered:** persisted operations only in production; leaving the endpoint open.

The endpoint is public and unauthenticated by design, and an open schema is an open
invitation: `race → meeting → races → meeting` nests indefinitely, and a ~1200-row replay
payload is a cheap thing to request in a loop. Both classes close in roughly fifteen lines.

Persisted operations are stronger — production would accept only the hashed documents
codegen emitted, and the endpoint would stop being a general GraphQL API to outsiders. It is
worth revisiting later. It was not chosen now because it adds a codegen step and makes
debugging production materially harder, for a portfolio site where depth and cost limits
already remove the failure that actually costs something: an unbounded Neon bill.

---

## 2026-09-03 — The replay payload travels as server-component props

**Decided:** the race page (a server component) runs the `RaceReplayFragment` query through
`execute.ts` and passes the result to the client player as a prop. `urql` covers race library
filters, standings toggles, and admin forms.

**Considered:** the player fetching its own data via urql on mount; splitting the payload so
the first laps ship in the HTML and the rest stream in as the user scrubs.

Fetching on mount costs a waterfall — HTML, then a POST, then a render — and, worse, the
payload would bypass the ISR cache entirely, so every visitor would hit Neon for the one
query in the application large enough to matter. Passing it as a prop puts it in the streamed
HTML, inside the cache, with no round trip.

The streaming split is the better answer if the payload measures large on a phone. It is not
worth its complexity before it has been measured; if M2's mobile criterion exposes a problem,
this entry gets a follow-up.

---

## 2026-09-03 — Tests run against PGlite

**Decided:** resolver and schema tests run against PGlite — Postgres compiled to WASM,
in-process — with migrations applied to a fresh instance per suite.

**Considered:** a Neon branch per CI run; a Docker Postgres service container.

The design already said resolvers would be tested "against a seeded test database" without
saying what that database was. PGlite needs no Docker daemon locally and no service container
or network in CI, so tests stay fast and hermetic, and `pnpm test` works on a fresh clone with
nothing installed.

A Neon branch would be the actual production engine with no behavioral gap, but it needs API
credentials in CI, branch cleanup, and a network round trip per query. The gap PGlite leaves
is extensions, and this schema uses none. If one is ever needed, this decision gets revisited
rather than worked around.

---

## 2026-09-03 — Mobile and keyboard access are M2 acceptance criteria

**Decided:** M2 is not done until the replay is usable at 390px width, the player controls
are operable by keyboard alone, and the timing tower is reachable as the canvas's text
alternative.

**Considered:** a polish pass in M4; declaring desktop-only in the README.

This is a portfolio piece, and a phone is the state most people will first open it in.
Deferring meant a late rewrite of layout and event handling, which is the expensive version
of the same work — whereas designing the ported components for it costs almost nothing,
since the timing tower is already a faithful textual rendering of what the canvas draws and
only needs to be reachable.

---

## 2026-09-03 — OpenF1 rate limits and where the throttle lives

**Decided:** the request throttle lives in `lib/ingest/openf1.ts`, not in its callers.

OpenF1's free tier serves historical data from 2023 onward at 3 req/s and 30 req/min. Its
paid tier covers only the live window — 30 minutes either side of a session — which a
Monday-morning ingest never touches, so the free tier is the permanent tier here, not a
starting point.

The ceiling is irrelevant to a cron run (one race) and load-bearing for a backfill (~24
meetings × ~8 endpoints ≈ 200 requests). Putting the throttle in the client means the cron
path inherits it rather than each caller remembering, and there is one place to change if the
limits move. A 429 or 5xx retries with backoff; a run that still fails is recorded `FAILED` in
`ingest_runs` with the error rather than swallowed.

---

## 2026-09-03 — Neon region `us-east-2`, Vercel functions moved to `cle1`

**Decided:** the Neon project lives in AWS `us-east-2` (Ohio), and the Vercel project's
function region is set to `cle1` (Cleveland) to sit beside it.

**Considered:** Neon in `us-east-1` (N. Virginia) to match Vercel's default `iad1`.

`us-east-1` was the first choice, since co-locating with Vercel's default region removes the
cross-region hop entirely. It was not offered at project creation, so the pairing was made
from the other side instead: leave the database where it is and move the compute to it.

The distance mattered less than it first appears — Ohio to Virginia is roughly 12ms, and the
public pages are designed to be served from a static cache that reaches no database at all.
The hop is only paid on the paths that genuinely need fresh data: the admin panel, the cron
handler, and any uncached render. Moving the functions makes even those cheap, for the cost
of one setting.

**Worth knowing for later:** if the app is ever deployed to a second region, this pairing
breaks silently — the far region pays the full cross-country round trip on every query. The
fix at that point is a read replica, not a region change.

---

## 2026-09-03 — The database client is built on first query, not on import

**Decided:** `src/db/index.ts` exports `getDb()`, which constructs the Drizzle client on
first call and memoizes it. `DATABASE_URL` is validated there, not at module scope.

**Considered:** a module-level `export const db`, with the environment check beside it.

The module-level version is the obvious shape and it failed the first Vercel deploy. Next.js
evaluates route modules during its "collecting page data" phase to read their route config —
including for a `force-dynamic` route that will never be prerendered. A check at module scope
therefore runs during the build, in an environment that has no database and needs none, and
a missing variable fails the build rather than the request.

The general rule this is an instance of: **validate a runtime dependency at the point it is
used, not at the point it is imported.** An import-time check runs in every context that
loads the module, including tooling that will never exercise the dependency. It looks stricter
and is in fact just louder in the wrong places.

The guard itself is unchanged and still has no fallback value — a missing `DATABASE_URL`
throws. Only its timing moved.
