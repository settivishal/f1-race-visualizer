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

Both deferred features are already built in v1 (`origin/feature/user`) and can be
ported when the foundation is stable. Shipping the core product first means the
foundation gets proven by something that matters before carrying a social feature.

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
