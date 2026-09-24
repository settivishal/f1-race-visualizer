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

---

## 2026-09-03 — Branch flow: add `dev` between `feature/*` and `main`

**Decided:** `feature/*` → `dev` → `main`. `dev` is the preview environment and deploys
against a Neon branch database; `main` is production and deploys against the production
database. Every change is merged twice.

**Reverses:** the 2026-09-02 deployment entry, which specified `feature/*` → `main` with
nothing in between.

**What changed.** The original reasoning was that v1's `dev` → `preprod` → `change` chain
produced three mutually-divergent auth implementations, and that per-PR preview deploys make
a staging branch redundant. The first half still holds — which is why this is *one*
intermediate branch and not three — but the second half missed something.

Vercel builds every pull request against whatever `DATABASE_URL` the project holds. With a
single database, a PR carrying a destructive migration applies it to production **before the
PR is reviewed**, from a branch nobody has approved. That is the hazard already named in
document 05, and it arrives for real in M1 when migrations start moving. Splitting the flow
gives the migration somewhere disposable to land first.

**Considered:** keeping `feature/*` → `main` and pointing preview builds at a Neon branch
database directly. That solves the migration hazard with no second branch to keep in sync,
and is the smaller change. It was not chosen because `dev` also provides a stable URL that
several merged changes can be viewed on together — a question per-PR previews cannot answer,
since each one shows a single change in isolation.

**The cost, stated plainly.** Two merges per change, for one developer. And `dev` and `main`
diverge the moment anything reaches `main` without passing through `dev` — which is most
tempting during a hotfix, exactly when it is least likely to be noticed.

**The rule that keeps it from becoming v1:** everything reaches `main` through `dev`, with no
exceptions, and if the two ever disagree, `dev` is deleted and re-cut from `main` rather than
reconciled. A reconciliation procedure maintained by one person is how v1's three auth
implementations survived as long as they did.

---

## 2026-09-04 — Branch protection: "up to date before merging" on `dev` only

**Decided:** both `main` and `dev` require a pull request, require the `check` CI job, enforce
the rules on admins, and forbid force pushes and deletion. **"Require branches to be up to
date before merging" is enabled on `dev` and deliberately disabled on `main`.**

**The deadlock it avoids.** Every GitHub merge type — merge commit, squash, and rebase alike —
advances the base branch with a commit the head branch does not contain. So the moment
anything is promoted from `dev` to `main`, `dev` is *behind* `main`. With the up-to-date rule
on `main`, the next promotion is blocked until `dev` is updated; but `dev` requires a pull
request for any change, so GitHub cannot push that update itself. The rule and the protection
make each other unsatisfiable, and the only way through is to disable the rule, merge, and
re-enable it — every single cycle.

There is no merge button that avoids this. GitHub offers no fast-forward merge, which is the
one strategy that would leave `main` and `dev` pointing at the same commit.

**Why the asymmetry is correct rather than a compromise.** The rule exists to catch a real
failure: two branches that each pass CI alone and break when combined. That risk is entirely
on the `dev` side, where independent feature branches converge — so the rule stays there.

On `dev` → `main` there is exactly one source branch, and its tree is identical to the one CI
just tested green. Re-running against a base that differs only by a merge commit tests nothing
that was not already tested. The rule buys no safety on that hop and guarantees the deadlock.

**Rejected:** syncing `dev` from `main` after each promotion, which is real work every cycle to
satisfy a rule that catches nothing on that hop; and dropping the pull-request requirement on
`dev` so the update button works, which would weaken the branch the flow exists to enforce.

**What this does not relax.** A pull request is still required to reach either branch, CI must
still pass, the rules still apply to admins, and neither branch can be force-pushed or deleted.
Only the up-to-date requirement on `main` is gone.

---

## 2026-09-06 — urql is deferred out of M2

**Decided:** M2 ships with no client-side GraphQL client. The race library's search and
filters are a `<form method="get">` read by a server component; the player receives its
payload as a prop. `urql` arrives in M3, with the admin mutations.

**Follow-up to** *The replay payload travels as server-component props* (2026-09-03), which
said "urql covers race library filters, standings toggles, and admin forms". The player half
of that entry stands. The library half does not.

**Considered:** wiring urql now as designed, so the HTTP transport has a real consumer.

`Query.races` already takes `season` and `search`, so the filtering the client would do is
filtering the database does better and the ISR cache can hold. Fetching it on the client
means shipping a cache, a provider and a round trip to re-derive a result the server can put
in the HTML — and it makes each filtered view unshareable, because the state lives in memory
rather than in the URL. A `<form method="get">` gives back the shareable URL, works before
the JavaScript loads, and costs nothing to write.

The cost of deferring is that `/api/graphql` has no browser consumer until M3, so the HTTP
transport is exercised only by GraphiQL and by hand. That is worth naming, and it is not
worth a dependency to fix.

---

## 2026-09-06 — The v1 explorer is replaced, not ported

**Decided:** `race-visualization-explorer.tsx` — the largest file on the v1 branch at 17.9KB
— is not ported. It becomes two server-rendered routes: `/races` (library) and
`/races/[slug]` (detail).

**Considered:** porting it near-verbatim like the rest of the replay tree, on the grounds
that it works.

It works by doing on the client what v2 does on the server: it fetches every race on mount,
holds the selected visualization in component state, and filters and sorts in the browser.
Everything M1.5 built exists so that the page can be rendered once, cached, and served
without touching the database. Porting the explorer would route the site's main entry point
around all of it.

The parts worth keeping are inside it rather than the shape of it: the skeleton, empty and
error states become Suspense boundaries on the new routes.

**Named here** because a file that large disappearing from a port should read as a decision
rather than an oversight.

---

## 2026-09-06 — Cache Components, and why the ingest cannot revalidate yet

**Decided:** `cacheComponents: true`. The cached reads live in `src/lib/queries.ts` as
`use cache` scopes carrying `cacheTag('race' | 'standings')` and `cacheLife('days')`. The call
that invalidates those tags arrives in M3 with the cron route, not in M2.

**Follow-up to** *Rendering: ISR, revalidated by the ingest job* (2026-09-03), which described
`revalidateTag('race')` as "the last step of the cron handler, after COMMIT". That is still the
design. What changed is only when it can be written.

`revalidateTag` runs in Server Functions and Route Handlers, because it needs a request context.
In M2 the ingest runs from `scripts/backfill.ts`, a CLI process — `src/lib/ingest/run.ts` is a
library it calls, and putting the call there would be code that cannot execute where it sits.
`POST /api/cron/ingest` is the handler that call belongs in, and that route is M3.

**Considered:** adding a `POST /api/revalidate` route now for the backfill script to hit over
HTTP. It would close the loop, but it means a publicly reachable endpoint that evicts the cache,
introduced one milestone before the auth that should guard it. A shortcut whose cost is an
unguarded endpoint is not a shortcut.

**What holds until then.** `cacheLife('days')` bounds the staleness at a day. The data changes
weekly, so a race imported today is visible tomorrow at the latest, and ordinary traffic still
never wakes Neon. The gap is that a fresh import is not visible *immediately*, which matters to
whoever ran the import and to nobody else.

---

## 2026-09-06 — Grid position is not displayed

**Decided:** the race classification table shows position, driver, team, laps and points. No
grid column.

`gridPosition` is null for every driver of every race in the database — verified across four
races, 20 of 20 rows each. This is not a defect: `src/lib/ingest/transform.ts` leaves it unset
because OpenF1 publishes no starting grid for these seasons, and the column is nullable so an
unknown fact can be stored as unknown rather than as a zero.

The schema field and the column stay. Only the rendering goes, because a column that reads
"—" in every row for every race is furniture that looks like missing data. It comes back if a
source for starting grids ever does.

---

## 2026-09-06 — The dark variant follows the tokens

**Decided:** the Tailwind `dark` variant activates under the system preference *and* an explicit
`.dark` class, matching the exact conditions the CSS custom properties already flip under.

The two halves of the theme had been disagreeing. `globals.css` declared
`@custom-variant dark (&:where(.dark, .dark *))`, but nothing in the application ever put `.dark`
on the document — v1 set it from an inline script that was not ported. The custom properties,
meanwhile, flip on `@media (prefers-color-scheme: dark)`. So on a machine set to dark, every
token-driven surface went dark and all 34 `dark:` utilities stayed light. Race event chips
rendered `bg-sky-50 text-sky-950` — pale blue with near-black text — on a near-black page.

Two ways to reconcile them: set the class from a script, or widen the variant. The variant is the
one that cannot drift, because it names the same condition the tokens name rather than a class
some other code is responsible for setting. It also needs no blocking inline script, and no
`suppressHydrationWarning` on `<html>`.

The `.dark` half of the selector stays, because the M4 theme toggle sets exactly that. A class on
the root overrides the preference in both directions; the preference is what applies when no class
is present.

---

## 2026-09-06 — Flag colours are tokens, not palette classes

**Decided:** race control colours — yellow, double yellow, red, safety car, VSC, chequered, green,
pit, penalty — are named design tokens. `getReplayEventTone` and `getReplayEventMarkerColor` in
`src/components/replay/replay-state.ts` stop returning raw Tailwind palette classes.

A yellow flag is not "the colour yellow-200". It is a signal with a fixed meaning in the sport,
and it needs to stay legible and stay *itself* across a redesign, a theme change, and any future
palette. Encoding it as a palette class ties a domain fact to a colour ramp that exists for
unrelated reasons, and it is why these strings carry a hand-written `dark:` variant each — nine
tones, each spelled twice, none of which were doing anything (see the previous entry).

As tokens they are defined once per theme and the components ask for the meaning rather than the
shade.

---

## 2026-09-06 — Dark-first, and the theme moves out of M4

**Decided:** the redesign is drawn dark-first. Light ships as the secondary mode. The dark theme
is no longer an M4 polish item.

`docs/system-design.md` lists "dark theme" under M4 alongside skeletons and error boundaries,
which framed it as a toggle to add at the end. That framing is what produced the split-brained
state above: a theme treated as a late addition never gets designed, only bolted on.

The replay is the centrepiece and it is a chart of twenty coloured lines. Team colours and the
position traces carry more contrast against a dark ground, and timing and telemetry products look
this way because of that, not as a style choice. Designing light-first and deriving dark would
mean tuning the mode the product is actually used in second.

What stays in M4 is the *toggle UI*. The mode itself is a foundation.


## 2026-09-06 — The chart panel stays dark in both themes

**Decided:** the position chart renders on `--track`, a surface that is dark in
light mode as well as dark mode, with white text on it. Everything around it —
the timing tower, the controls, the story panel — follows the theme normally.

The chart's whole job is to let twenty coloured lines be told apart at a glance,
and team colours are chosen against the dark of a broadcast graphic. On a light
ground the pale liveries wash out and the traces stop separating, which is the
one thing the component exists to do.

This is the same reasoning a video player uses for its own dark chrome on a
light page: the surface belongs to the content, not to the document.

**Consequence to know about:** `text-white` and `border-white/10` inside
`race-visualization-canvas.tsx` and the `#f8fafc` driver codes in
`race-car.tsx` are correct as literals and should not be "fixed" into tokens.
The component carries a comment saying so, because it otherwise reads exactly
like the hardcoding this milestone spent four PRs removing.


## 2026-09-06 — Three guard layers, not two

**Decided:** admin access is guarded in three places, and none of them is redundant with
another.

| Layer | Guards | Why it cannot be dropped |
|---|---|---|
| `proxy.ts` | Page navigation | Sends a logged-out visitor to `/login`. UX, not a security boundary. |
| Each Server Action | Writes | An action is a POST endpoint, reachable without ever loading the page that defines it. |
| Resolver context | Data | `/api/graphql` is one public URL serving public and admin operations. |

`docs/whiteboard/05-delivery.md:118` already described two layers — middleware for pages,
resolvers for data — and explained why neither substitutes for the other. The third comes
from choosing Server Actions for writes, which the whiteboard predates.

Next's own documentation is explicit about why. From the Proxy reference: *"A matcher change
or a refactor that moves a Server Function to a different route can silently remove Proxy
coverage. Always verify authentication and authorization inside each Server Function rather
than relying on Proxy alone."* And from the data-security guide: *"A page-level
authentication check does not extend to the Server Actions defined within it."* An exported
Server Action is reachable by direct POST whether or not anything imports it.

**Why it matters here:** the failure is silent. An action with no `auth()` call works
correctly through the UI forever, because the UI only reaches it from a page the proxy
already guarded. Nothing surfaces the gap until someone posts to the action directly.

**How to apply:** every function in `src/app/admin/actions.ts` calls `auth()` as its first
statement. A new action without one is a defect even if the page above it is guarded.

---

## 2026-09-06 — middleware.ts is proxy.ts now

**Decided:** the route guard lives in `proxy.ts`, not `middleware.ts`.

`docs/system-design.md:548` specifies `middleware.ts`. Next 16 deprecated that file
convention and renamed it to `proxy.js|ts` — same functionality, new file and export name,
with a codemod for the migration. The design doc predates the rename.

Two consequences worth recording, because they remove work the usual Auth.js v5 setup does:

**Proxy defaults to the Node.js runtime**, and setting the `runtime` option inside a proxy
file now throws. The familiar `auth.config.ts` / `auth.ts` split — an Edge-safe config
without the database or bcrypt, plus a Node config with them — exists only to keep those out
of an Edge bundle. That constraint is gone, so there is one `src/auth.ts`.

The proxy still does no database work. Next may deploy a proxy to the CDN, and the design's
JWT session strategy means the check is a signature verification rather than a query. That
was already the reason for choosing JWT (`05-delivery.md:113`); it is also what keeps the
proxy cheap.

---

## 2026-09-06 — urql is not used, and that is now the decision

**Decided:** no GraphQL client library. Server components read through `executeQuery`, and
writes go through Server Actions that call the same function.

`docs/system-design.md:572` says "interactive parts through urql", and the M2 entry deferred
it with "Revisit in M3, where mutations give it a job". M3 has arrived and the job did not
materialise.

Writes go through Server Actions because `revalidateTag` only runs in a Server Function or
Route Handler — it needs a request context. That is not a preference, it is where the API is
allowed to execute. With writes server-side, the admin has no client-side fetching left to
cache: the pages are server components reading the same schema the public pages read.

Adding urql now would mean a provider, a client configuration and a second data path into
the same schema, to serve no consumer. The earlier entry deferred the decision; this one
makes it, so it stops reading as an oversight.

**If it comes back:** something genuinely interactive that mutates and re-reads on the
client — a live-updating ingest progress view, say — is the case that would earn it.


## 2026-09-06 — updateTag in actions, revalidateTag in the cron

**Decided:** Server Actions call `updateTag`; the cron route calls
`revalidateTag(tag, 'max')`. The design documents say `revalidateTag` in both places, and
`updateTag` did not exist when they were written.

They differ in who waits.

`updateTag` expires the entry outright, so the next request blocks until fresh data is ready.
That is read-your-own-writes, and it is what an admin needs: after triggering an import,
seeing the old page is indistinguishable from the import having failed. It is also
Server-Action-only — a Route Handler cannot call it.

`revalidateTag(tag, 'max')` marks the data stale and serves the stale copy while refreshing
in the background. That is the right trade for the cron, where nobody is waiting on the
result and a visitor who happens to arrive first should not pay for the regeneration. Passing
no second argument is deprecated and behaves like `{ expire: 0 }`, which would make that
visitor block.

So the distinction is not a preference but the two halves of the same idea: the person who
caused the change waits for it; everyone else gets the last good page until it is ready.

**Unchanged:** invalidation is still the last step and still only runs after the write
succeeds — `05-delivery.md:71`. If it ran first and the write then failed, the cache would be
dropped and not replaced, and the next visitor would re-render from unchanged data, having
lost a page that was working.


## 2026-09-06 — The cron endpoint answers GET as well as POST

**Decided:** `/api/cron/ingest` exports both `GET` and `POST`, running the same handler.

`docs/system-design.md:554` and `05-delivery.md:151` both specify `POST /api/cron/ingest`.
Vercel's scheduler invokes a cron path with a **GET**. A POST-only handler would therefore
return 405 to the only caller that matters, once a morning, forever.

The reason this is worth recording rather than just fixing is the failure it would have
produced. Nothing errors. The endpoint is correct, the schedule is correct, the secret is
correct, and no exception is raised anywhere — the site simply stops importing races, which
is precisely the silent-cron failure `ingest_runs` exists to catch, arriving through the one
route that page cannot explain. It would have looked like an OpenF1 problem.

GET is what Vercel calls; POST is what a person calls with curl, and what verification step 6
uses. Vercel adds `Authorization: Bearer $CRON_SECRET` to its own request when that variable
is set, so both paths authenticate identically and neither needs a special case.


---

## 2026-09-07 — After M4: the site becomes a product, not a portfolio piece

**Decided:** four more milestones — M5 race analysis, M6 the 2018+ archive, M7 motion and
polish, M8 production hardening. Written out in `system-design.md`.

Every milestone in the original plan is shipped, so the design doc stopped saying what
happens next. The choice was to stop at a finished portfolio project or to keep going.
Vishal chose to keep going, with three constraints that shape everything below: the archive
goes back to **2018 and no further**, the whole thing stays on the **free tier**, and the
first slice must be **visible to a visitor**, not infrastructure.

**Considered:** the two features deferred at the start — public accounts and the Armchair
Strategist prediction game. Both lose to analysis and archive on the same argument: they add
a second product on top of a single season of data, where the archive makes the product that
already exists worth more. They stay deferred.

---

## 2026-09-07 — Jolpica (Ergast) is reinstated for 2018–2022

**Decided:** a second ingest client, `lib/ingest/ergast.ts`, alongside `openf1.ts`. OpenF1
remains the only source for 2023 onward.

**Supersedes** the 2026-09-03 entry "Jolpica (Ergast) dropped; OpenF1 is the only upstream".

That entry accepted a cost — "no season before 2023 can ever be imported" — on the reasoning
that pre-2023 seasons would be "standings tables with no races behind them". That reasoning
was wrong on the facts, and the facts were checked this time rather than assumed:

- Jolpica serves **per-lap position and lap time from 1996**, which is exactly the payload
  the replay renders. 2018–2022 is not a standings table; it is 105 more replayable races.
- It serves **starting grid from 1950**. OpenF1 publishes no grid at all and has no
  `/starting_grid` endpoint, which is why `race_results.grid_position` has sat unpopulated
  since M1 and why no page can show a grid-versus-finish delta.

What the original entry got right stands: a second client is a second rate limit and a second
failure mode. It is scoped accordingly — Ergast is used for the closed 2018–2022 window and
for grid positions, never for a live race weekend, so the cron path keeps exactly one
upstream and its failure modes do not change.

Measured limits, 2026-09-07: 100 records per request (hard cap), 4 requests/second burst,
500/hour sustained. A race's lap data is ~10 requests; a season is ~280, about 35 minutes.
The backfill therefore runs from a `workflow_dispatch` GitHub Action per season, not from a
serverless function, the same way the original season backfill did.

**Cost, accepted:** 2018–2022 races have no sector times, no gap strings, no race control
messages and no tyre stints, because only OpenF1 publishes those. Those races are a thinner
replay, not a broken one.

---

## 2026-09-07 — A race declares which tier of data it has

**Decided:** `races.data_tier` — `FULL` for OpenF1-sourced races (sectors, gaps, race
control, stints) and `LAPS` for Ergast-sourced ones (position and lap time only). The UI
branches on the tier; it never infers coverage by checking whether a column is null.

Two sources with different fidelity would otherwise be indistinguishable from two sources
where one had a bad import. A missing sector time means "this era has no sector data" in one
case and "the ingest dropped rows" in the other, and `ingest_runs` is the only place that
difference is currently visible.

**Considered:** deriving the tier from `openf1_session_key IS NOT NULL`. It is the same
information today and stops being so the first time a race is re-imported from the other
source, which is precisely when a wrong answer would be hardest to see.

---

## 2026-09-07 — Circuits become a table; `lib/circuit-data.ts` is retired

**Decided:** a `circuits` table populated from Ergast, with `meetings.circuit_id` pointing at
it.

`src/lib/circuit-data.ts` is a hardcoded lookup keyed by country and race name, holding
length, turns, first-GP year and lap record for the 2025 calendar. Keyed by country, it
cannot answer "Spain, 2019" versus "Spain, 2025" differently, and there is no key at all for
a circuit that has left the calendar — Hockenheim, Sochi, Paul Ricard, all of them inside
the 2018 window. Every season added makes the lookup more wrong.

**Cost, accepted:** Ergast gives name, locality, country and coordinates but not turn count
or lap record, so those two fields keep a small hand-maintained overlay rather than
disappearing. That is a table of static facts about physical places, which is the one kind of
data that genuinely does not need an API.

---

## 2026-09-07 — Charts are hand-written SVG, with no new dependency at all

**Decided:** no charting framework, and in the end no chart library of any kind. The
analysis charts are SVG written the same way the replay canvas is written, over about
thirty lines of scale and tick maths in `lib/scale.ts`.

The replay is already a hand-built 1120×640 SVG with its own axes, ticks, tooltips and
motion, and it is the best-looking thing in the project. A chart library would put a second,
differently-styled rendering model beside it, and every theme token, focus ring and
reduced-motion rule would have to be re-fought inside someone else's component API.

**Considered:** Recharts and visx. Recharts brings its own React tree and ~90 KB for what is
here a line, a band and a box plot. visx is closer to the right level but is a large family
of packages for the two modules actually needed.

`d3-scale` + `d3-shape` were planned as the compromise — ~15 KB, tree-shakeable, the parts
of d3 that are pure maths. Writing the first chart showed the compromise was not needed:
every axis on this site is a linear scale over numbers (laps against seconds), and a linear
scale plus round-number ticks plus a polyline path is `lib/scale.ts`, tested. The packages
would also have brought time, log, quantile, ordinal and diverging scales, none of which is
coming.

The parts that are genuinely hard — nice ticks that do not read as 90.30000000000001, a
zero-width domain that must not divide by zero — are the parts with unit tests, which is
where the confidence comes from rather than from a dependency's reputation. `framer-motion`,
already in the tree for the replay, animates the results.

---

## 2026-09-07 — Ergast ids are added beside the existing keys, not instead of them

**Decided:** `drivers.ergast_driver_id`, `teams.ergast_constructor_id` and
`circuits.ergast_circuit_id`, all nullable except the circuit's. `drivers.code` and
`teams.name` keep their UNIQUE constraints.

**Amends** the M6 sketch in `system-design.md`, which said `drivers.code` would lose its
uniqueness.

Dropping it would have meant rewriting the OpenF1 ingest's upsert, which conflicts on
`drivers.code` and has no Ergast id to use instead — a change to the working import, made
for the benefit of an import that does not exist yet. Codes do collide across the full
history of the sport; they do not collide inside 2018-2025, which is the whole scope.

Constructor *names* are the identity that actually moves inside the window — Racing Point
to Aston Martin, Toro Rosso to AlphaTauri to RB to Racing Bulls — so matching an archive
import on the name would have created a second team row on each rebrand. That is what the
constructor id is for.

**The rule this follows:** a nullable column added beside a working key costs one migration
and breaks nothing. Replacing the key costs a migration, a backfill, and a rewrite of the
one pipeline currently keeping the site up to date.

---

## 2026-09-07 — A migration's own PR needs the dev database migrated by hand

**Observed, then decided:** `migrate.yml` runs on a **push to `main` or `dev`**, never on a
pull request. So the PR that introduces a migration builds new code against a database that
does not have it yet, and its Vercel preview fails — which is exactly what M6.1 did, on
`races.data_tier`: every race query selects every column, including at build time in
`generateStaticParams` and the sitemap.

M5 did not hit this only because it added *tables* nothing queried at build time.

**Decided:** before opening a PR that adds a migration, run the Migrate workflow by hand
(`workflow_dispatch`) against the dev branch database. That is what the manual trigger was
put there for, and it is why applying migrations is idempotent — drizzle-kit skips whatever
the journal already records.

**Considered and rejected:** migrating from the Vercel build. It is the exact thing
`decisions.md` already forbids — preview builds would migrate a database concurrently with
other builds, and a preview of an abandoned branch would leave its columns behind forever.

**Considered and deferred:** a preview-only Neon branch per pull request. It is the right
answer at a bigger scale and it costs money and setup this project has decided not to spend.

**What this means in practice:** a red Vercel check on a migration PR is expected until the
dev database is migrated, and green after. The GitHub `check` job is the one that must pass
on its own merits — it runs against PGlite with the migrations applied to a fresh instance,
so it is unaffected.

---

## 2026-09-07 — `lib/circuit-data.ts` is retired; circuits come from the database

**Decided:** the circuit panel reads the `circuits` table, and the hardcoded lookup is
deleted. The three facts Ergast does not publish — length, turn count, first grand prix —
are seeded into that table by `scripts/seed-circuits.ts`, keyed by Ergast's circuit id.

The old module held those numbers keyed by **country**, and ended with a fallback that
returned *15 turns, 5.0 km, first held in 1950* for anything it did not recognise. With one
season on the site that was survivable. With an archive it is not: Hockenheim, Sochi, Paul
Ricard, Mugello, Portimão, Istanbul and the Nürburgring are all inside the 2018-2022 window,
and every one of them would have rendered those invented numbers as though they were facts
about that circuit. A country key also cannot tell Spain 2019 from Spain 2025, and cannot
hold two races in one country in one season.

**What was lost, deliberately:** the circuit map image and the lap record. Both were
hardcoded, and the image was hotlinked from `media.formula1.com` — someone else's bandwidth
for an asset that breaks when they reorganise their CDN. Images move to Vercel Blob in M7,
where the driver headshots and team logos are going; until then the panel shows the facts it
can stand behind. A missing figure is now simply absent rather than guessed.

**Considered:** keeping the file as an overlay keyed by circuit id. That is what the seed
script is, minus the fallback and minus a second copy of the same numbers living in the
application bundle — the values belong in the row the page already reads.

---

## 2026-09-08 — The season the site is about is configuration, not a constant

**Decided:** `Query.activeSeason` reads `app_config.active_season`, and the home page and
the standings default follow it. The two hardcoded constants are deleted.

This was not a tidying exercise. `app_config.active_season` had been 2025 since the winter,
and the ingest cron obeys it — so from March onward the job ran every morning against a
season with nothing left to import, answered "up to date", and wrote no row to
`ingest_runs`, because a skip writes none. Correct code, correct schedule, six months of
importing nothing, and no error anywhere. Meanwhile `page.tsx` and `standings/page.tsx` each
held their own opinion that it was 2025, so even fixing the config would have left the site
disagreeing with the job feeding it.

Three places held a view about what year it was and only one of them was editable without a
deploy.

**Fallback:** the newest season that has a race, not the calendar year. In January the
calendar year is a season nothing has happened in, and an empty home page is a worse answer
than a slightly stale one.

**Set it through `/admin/settings`, not the database.** The action calls
`updateTag('settings')`; writing the row directly does not, so the home page keeps serving
the old season from cache until the entry expires. That cost a redeploy to discover.

---

## 2026-09-08 — A session is resolved by key, not by walking a list of years

**Decided:** `fetchSessionByKey` asks OpenF1 for `/sessions?session_key=N`. The year loop in
`run.ts` is deleted.

Resolving a session used to mean fetching whole seasons from the hardcoded list
`[2025, 2024, 2023]` and filtering for the key. Every 2026 import failed with "session not
found" while the API had the data all along — Monza's race has 678 position rows and answers
to that URL directly. The weekly cron calls the same function, so it would have failed the
same way in March and reported nothing wrong.

A list of years is a bug with a date on it. This one was written in a codebase that already
knew it would be importing 2026.

---

## 2026-09-08 — The whole calendar is stored, and a race has a status

**Decided:** the backfill imports every scored session of a season, run or not. A race that
has not happened is a meeting, a date and an entry list with no positions. `races.status` is
`SCHEDULED | COMPLETED | CANCELLED`.

`laps === 0` had been carrying three meanings at once — not yet run, cancelled, and imported
but empty — so the two 2026 rounds abandoned in April rendered as *upcoming*, counting down
to a date months past.

Storing the calendar is what gives the season progress bar a denominator and the countdown a
target. Without it the home page said "15 of 15 rounds complete, season complete" in the
middle of a season.

**`laps === 0` is the test for "not run", not a comparison against the clock.** These render
inside `use cache` scopes with a day's life, so a server-side reading of "now" would be baked
into the cache entry and go stale. The lap count is a fact about the data and cannot.

**Status only moves forward.** An import can promote a race to COMPLETED and never demote
one: a re-import that fetches nothing means upstream is having a bad day, not that a race
un-happened. CANCELLED never comes from an import at all.

**A cancelled race keeps its round**, badged and struck through rather than hidden. The 2026
season did schedule a Bahrain round; a calendar that hides it is a calendar that never
existed. It is excluded from "rounds remaining", because no points will be scored there.

---

## 2026-09-08 — Upstream is a default; an admin correction wins and persists

**Decided:** `meetings.admin_edited` and `races.admin_edited` are `text[]` columns naming the
columns a person has set by hand. The ingest checks the list before overwriting anything.

The admin editor for a meeting's name, country, circuit and laps has existed since M3, and
every edit it made was reverted by the next weekly import, because the upsert assigned those
columns. The editor was a lie for its entire life, and nothing surfaced that.

Upstream gets races wrong in ways no feed models. 2026 abandoned two rounds mid-season, and
the round that replaced one of them is still filed as "Bahrain Grand Prix" in "Bahrain" while
being held at Sepang. Somebody has to be able to say otherwise and have it stick.

**One array per table, not an override column beside every field.** It protects any column
including ones not written yet, and clearing a field in the admin drops it from the array so
upstream takes over again — that is the undo, and it stores no history.

**The risk, and what answers it:** a field pinned by accident goes stale silently and nothing
upstream can correct it. So the admin shows which fields are pinned and offers the way back.
Without that this trades a visible bug for an invisible one.

---

## 2026-09-08 — A driver number belongs to a season

**Decided:** `drivers.number_season` records where the stored number came from, and an
import takes the incoming number only from a season at least as recent.

`drivers.number` is one column per driver and the upsert assigned it, so the number the site
showed was whichever race imported last. It looked correct only because 2026 happened to be
imported after 2025 — the 2018-2022 backfill would have put Verstappen back on 33 across the
whole site. The columns either side of it, `headshot_url` and `ergast_driver_id`, were
already careful not to be clobbered; this one was not.

Driver names had the same shape and are fixed the same way: normalised at ingest, so
OpenF1's "Kimi ANTONELLI" and Ergast's "Kimi Antonelli" agree and it stops mattering which
import ran last. Only ALL-CAPS tokens are touched, which leaves "Kimi Räikkönen" and
"Antonio Giovinazzi" alone and handles "ZHOU Guanyu" — surname first — correctly.

---

## 2026-09-08 — Health is "a race ran and is not imported", not "the last run is old"

**Decided:** `/api/health` reports races whose date passed more than 48 hours ago and are
still SCHEDULED, an active season with no races at all, and a most-recent ingest run that
failed. A scheduled workflow asks production daily and fails when the answer is no.

The obvious check is the wrong one. Between races there is legitimately nothing to import
for a fortnight, and over winter for months — a staleness threshold either cries wolf or is
loose enough to catch nothing. It would not have caught the six-month failure either, because
that job was succeeding.

Storing the whole calendar is what makes the real question askable without calling upstream:
a race that has been run and is not in the database.

**503, not 200 with a flag**, so a monitor does not have to parse a body. **Public**, because
requiring a secret means the check cannot run from anywhere, which is most of its value — and
it exposes which season is configured and which races are missing, operational facts about a
site whose whole content is public race data.

---

## 2026-09-08 — Unlayered CSS was silently beating every utility

**Decided:** every hand-written rule lives in `@layer base` or `@layer components`. Two e2e
tests assert that a utility still wins.

`button, input, select, textarea { color: inherit }` and `a { color: inherit }` were written
as plain CSS after `@import "tailwindcss"`. Unlayered CSS outranks every layered rule
whatever its specificity, so both had been overriding `text-on-accent` on every button and
link on the site — the primary button rendered the page foreground on red instead of white,
for months, and looked deliberate. axe found it; no person had.

The design-system classes added later had the same shape. `.type-page-title` sets a font size
and weight, so `<h1 className="type-page-title text-2xl">` would have ignored the utility.
Nothing had tried it yet.

**The failure has no symptom** other than a class that quietly does nothing, which is why
this is a test rather than a convention. A media query around a class is still unlayered if
the class is — the page title's responsive step needed wrapping separately.

**Related:** one accent cannot be both text on a dark ground and a fill behind white.
`#ff2016` is 5.2:1 as text and 3.8:1 as a fill, and darkening it fixes one while breaking the
other, so `--accent-fill` is its own token. The chart panel is a fixed dark surface in both
themes and gets `--on-track-accent`, because the theme's accent lands on it at 3.7:1 in light
mode. `--subtle` was under AA in both themes and was darkened.

---

## 2026-09-08 — `race:${slug}` is deleted rather than made to work

**Decided:** cached race reads carry the broad `race` tag only.

The narrow tag was written on three reads with a comment saying a single re-import should not
evict the season, and nothing ever invalidated it — a targeting ability no caller could use.

Reinstating it means splitting the taxonomy: per-race pages under a narrow tag, lists under a
broad one, and every write choosing correctly between them. The failure mode of choosing
wrong is a page that should have been dropped and was not. Stale data is worse than the
rebuild this saves, and an ingest imports one race a week.

**Also deliberately absent:** `serverActions.allowedOrigins`. Next already compares a Server
Action's Origin against the Host; the option exists for proxy and CDN domains where those
legitimately differ, and nothing sits in front of this site. A hardcoded production domain
would be a value to maintain that protects nothing, on a config where every preview
deployment has a different hostname.

---

## 2026-09-08 — Reversal: images are not mirrored into Vercel Blob

**Reverses:** "2026-09-02 — Images: downloaded at ingest into Vercel Blob", and the closing
paragraph of "2026-09-07 — `lib/circuit-data.ts` is retired", which said the images were
going there in M7.

**Decided:** driver headshots stay stored as upstream URLs and displayed nowhere. Nothing is
copied into Blob.

Two things were true when M7.5 came to be built and neither had been checked when the
original decision was made.

There are no hotlinks left to move off. `lib/circuit-data.ts` was the only thing loading a
remote image and M6.4 deleted it; nothing in `src/` renders an `<img>` or a `next/image` at
all. The `images.remotePatterns` entry that allowed `media.formula1.com` was removed as dead
configuration.

And `/about` already says, in its own words, that headshot URLs "are stored but not displayed
anywhere on the site: those images are not offered under a licence that would let this
project republish them". Downloading them and serving them from our own domain is *more*
republication than hotlinking, not less. The original decision was about optimisation and
bandwidth and never considered the licence.

**What would change this:** Wikimedia has CC BY-SA team logos and circuit diagrams, and
`/about` already carries that style of attribution. That is a product decision about what the
site shows, not a plumbing task, and it has not been taken.

**Also deferred with it:** `next/dynamic` for the replay islands, on the grounds that the
premise had gone stale. The replay and `framer-motion` are one 168K chunk that the
client-reference manifest shows is pulled in by `/races/[slug]` alone — the bundler already
scopes it to the only route that renders it. The remaining win is that `?view=analysis` still
ships the replay's JS, and Next's own guide is explicit that `next/dynamic` from a Server
Component does not code-split, so collecting it means a client boundary whose only job is to
defer the secondary tab.

---

## 2026-09-09 — Security headers ship without a CSP

**Decided:** `next.config.ts` sends `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and a `Permissions-Policy` on every path. No `Content-Security-Policy`.

A correct CSP means a nonce, because the root layout ships the inline theme script that
prevents the light/dark flash. A nonce is per-request, so the root layout goes dynamic and
every `use cache` page loses its prerender — the whole site pays render cost on every hit to
harden against injection on a site with no user-supplied content and no third-party scripts
beyond Vercel Analytics.

**What would change this:** any user-generated content, or an inline script that can be moved
into a file without reintroducing the flash.

HSTS is not in the list: Vercel already serves it, verified on the live response.

---

## 2026-09-09 — The missing-lap notice is derived on the client

**Decided:** the replay derives the gaps in its own lap coverage from the payload it already
has — the sparse `laps` array and `race.laps` — rather than from a new `ReplaySummary` field.
`describeMissingLaps` in `replay-state.ts`.

The hardening plan proposed a nullable GraphQL field. Both inputs are already in the fragment
every replay fetches, so the field would have been a resolver, a schema change, a generated
type and a codegen run to move a number the client is holding.

The notice also covers the truncated case — a race whose highest lap present is below its
distance ends before the flag rather than at it. There is no synthesized chequered flag to
suppress: that status only appears when upstream published the event.

**Also in this pass:** `src/env.ts` fails a production build that is missing a required
variable rather than serving localhost canonicals.

---

## 2026-09-09 — A bad race slug stays a soft 404

**Decided:** the race page's existence check is hoisted above `Suspense`, so nothing of the
race renders for a slug that does not exist — but the response is still 200 with Next's
injected `noindex`, not a 404.

The hardening plan assumed the hoist would fix the status. It does not. Cache Components
streams a static shell for every dynamic route, so the response is committed before the page
function runs; the `notFound` reference
(`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`) is explicit
that a real 404 status has to come from `proxy.ts` instead.

Doing that means a database read in the proxy, on a file whose comment currently says "No
database access here" — a query on every request to a race URL, to change a status code that
only crawlers read, on a route where `noindex` already keeps the soft 404 out of search.
Not taken.

**What would change this:** a slug list cheap enough to check in the proxy without a query.

---

## 2026-09-09 — Still no chart library, and now with numbers

**Decided:** the charts stay hand-drawn on `lib/scale.ts` and `ChartFrame`. Recharts was
built, measured and closed (PR #88).

The original decision (M5) was made before there was much to convert, so this time the
lap-time chart was actually ported and rendered beside the existing one on the same race.

It works, and looks near-identical. What it cost:

- **155 KB gzipped** on the client, from `recharts` and the `victory-vendor` d3 bundles it
  pulls — roughly double the route's existing JS, for one chart.
- **No fewer lines.** ~215 against 205. The custom parts — the pivot to row-oriented data,
  the outlier dots, the dashed bridges, the domain — are the bulk of the component either
  way.
- **Worse axis ticks.** `niceTicks` gives 1:25.000 and 1:30.000; Recharts ticks the raw
  domain and gives 1:22.591 and 1:26.591, so `lib/scale.ts` would have stayed anyway.
- **Two workarounds.** Its axis sizes itself to every series drawn on it, so the faint
  out-of-range outlier dots dragged the domain until the whole field flattened into one
  line — fixed with `allowDataOverflow` and a two-pass domain. And `connectNulls` joins
  every gap rather than only the ones that are bridges, so each dashed bridge had to be its
  own `ReferenceLine segment`.

The deciding fact is that three of the four charts do not convert: the replay's position
chart (per-frame interpolation through framer-motion, car badges, event markers, focus
dimming), the stint chart, and the head-to-head bars. `ChartFrame` and `scale.ts` stay for
those regardless — so a library here *adds* a dependency rather than replacing one.

Its one real advantage was a hover tooltip across all series, which `<title>` per point
cannot do. That is now built natively (PR #89): a crosshair snapped to laps that exist, and
an HTML readout through a new optional `overlay` slot on `ChartFrame`.

**What would change this:** a chart type that is not a linear scale over numbers — a map, a
tree, anything needing layout rather than plotting.

---

## 2026-09-10 — Team logos: the licence is not there, so the strip abbreviates instead

**Answers:** the open question left by "Reversal: images are not mirrored into Vercel Blob",
which named Wikimedia's CC BY-SA marks as the thing that would let team logos onto the site.

**Decided:** no team logo is shown. The season strip carries the team's short code — FER,
MCL, RBR — in the ink its livery can take, and `lib/team-marks.ts`, the manifest built to
hold licensed logo files, is deleted with it.

The premise turned out to be wrong for constructor logos specifically. Checked on Commons
before building anything: `McLaren Speedmark.svg` carries `PD-textlogo` — simple shapes, no
copyright, trademark notice attached — but Ferrari's mark is not on Commons at all, only
photographs of it, because the prancing horse is figurative and copyrighted. That split runs
through the grid: wordmarks are public domain, emblems are not, so roughly half the 2026
teams could be badged and half could not.

A strip where five rounds carry a logo and six carry a colour is worse than one that carries
neither. It reads as a loading failure, and the missing half would be the teams a reader is
most likely to look for.

A monogram costs no licence, covers a team the ingest invented last week, and is the
abbreviation a timing screen already uses. `inkOn()` picks black or white per livery by
relative luminance rather than by convention: the 2026 Ferrari red is bright enough that
white on it is 4.3:1, under AA, which "red means white text" would have shipped.

**What would change this:** a team supplying its own mark under terms this project can
state, or the site becoming something other than an unaffiliated fan project. Neither is
close.

---

## 2026-09-10 — The site is called RaceLines

**Decided:** the product name is **RaceLines**. The wordmark reads Race**Lines**, the
title template is `%s — RaceLines`, and "F1 Race Visualizer" and "Raceviz" are gone from
every user-facing string.

"F1 Race Visualizer" described a category, not a thing, and put a trademarked initialism
first — the site is unaffiliated, and leading with someone else's mark is the wrong way
round even with the disclaimer this site carries. "Raceviz" was better but named the
technique. A line is what the site actually draws: one per driver, across the laps, and
the whole product is the shape those lines make.

**Not renamed:** the GitHub repository, the local folder, the Vercel project and the
deployed URL, all still `f1-race-visualizer`. Renaming the Vercel project changes the URL,
and every link anyone has been given points at the current one — a rename would be a
redirect to maintain in exchange for tidiness nobody sees. The name inside the product and
the name of the box it ships in are allowed to differ.

**What would change this:** a custom domain, which is where the deployed URL stops being
an implementation detail and starts being the name people type.

---

## 2026-09-24 — Pre-race win prediction, and the archive hold is lifted

**Decided:** RaceLines publishes a win probability for every driver after qualifying, from
a gradient-boosted model trained offline. This is the machine half of the Armchair
Strategist, which the 2026-09-07 entry kept deferred; the user-facing game stays deferred.
The plan is `docs/ml-prediction-plan.md`.

**The 2018–2022 hold is lifted.** 2023 onward is about 90 grands prix and about 90
winners, most of them one driver. Every archive season doubles as training data, so they
are imported through the existing `backfill-archive.yml`, season by season, dev first.

**The model reads qualifying position, not the grid.** The grid is the stronger signal, but
Ergast publishes it only with the race result, so it does not exist when a prediction is
published. Training on the grid and serving on qualifying order would score the model on
information it never has. Qualifying comes from Ergast's `/qualifying`, read by the
feature builder and not stored: nothing on the site shows it.

**Two CSV hand-offs, no ML table.** `scripts/build-features.ts` writes the feature table to
a file; Python (`ml/`, its own project, never imported by the app) reads it and writes
`predictions.csv`; `scripts/import-predictions.ts` validates and upserts that into
`race_predictions`. Python never connects to Postgres, so the schema has one owner and a
local run cannot write to production by accident. The feature table is not in Neon because
only an offline job reads it, and every read would cost transfer on the free plan.

**Ergast is now read on every OpenF1 grand-prix import.** This relaxes a rule stated in
`system-design.md` and in the 2026-09-07 entry: the live cron path talks to exactly one
upstream. The grid is the reason. OpenF1 publishes none, and `race_results.grid_position`
has been null for every 2023+ race since M1. The points repair from #112 already read Ergast
on this path, but only when a suspect row existed; the grid fill reads it for every grand
prix. The cost is a second failure mode on the weekend path, and Ergast usually lags the
race by hours. It is contained by making the read best-effort. Races are matched by date,
never round. A miss is a warning and a null grid, never a failed import. `sqlCoalesce`
keeps a grid that an earlier import found. The model never reads the grid, so a null costs
an analysis column, not a prediction.

**Considered:** a `driver_race_features` Drizzle table (the first draft of the plan), and
Python writing predictions straight to Neon. Both put ML output into the schema before
anything needed it.

**What would change this:** a page that needs qualifying or features at request time, or
a model good enough to justify running before qualifying, where only form is known.
