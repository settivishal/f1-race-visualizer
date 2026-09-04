# 05 · Delivery

> **Where you are:** the last document. 02–04 covered how the system works. This one covers how it reaches people and stays correct — caching, auth, testing, migrations, and the milestone path from empty repo to shipped site.

---

## Part 1 — Rendering: ISR, and why not the alternatives

### The three options, and the constraint that picks one

Next.js offers three rendering modes for a public page. The right one follows directly from a single question: **how often does this data change?**

Race data changes **once a week**, when the ingest job runs.

| Mode | What it does | Verdict here |
|---|---|---|
| **SSR** (dynamic) | Renders per request | Wasteful — every visitor pays for a render of data identical to the last visitor's |
| **SSG** (static at build) | Renders at build time | Wrong shape — new race data would require a redeploy |
| **ISR** | Static, revalidated on demand | **Correct** — matches the change frequency exactly |

### What SSR would actually cost

Worth being concrete, because "it's a bit slower" undersells it.

Every visitor triggers: a server component render, a GraphQL execution, six SQL queries (document 04), and a round trip to Neon. That is real latency per visitor — but the sharper problem is **Neon's free tier autosuspends after inactivity**. A portfolio site's traffic is sporadic by nature, so a meaningful share of visitors would be the one who wakes the database up, and would wait several seconds for a cold start before seeing anything.

The first impression of a portfolio site would be a spinner, caused entirely by re-rendering data that has not changed in six days.

### What ISR does

A page is rendered once and cached at Vercel's edge. Subsequent requests are served from the cache: **no server component, no resolver, no Drizzle, no Neon.**

```
PUBLIC PAGE LOAD — cache hit (the common case)
  browser → Vercel edge cache → HTML. No resolver, no Drizzle, no Neon.

PUBLIC PAGE LOAD — cache miss or post-ingest revalidation
  browser → Vercel → server component → execute() → resolvers
          → DataLoader → Drizzle → Neon → HTML streamed back + cached
```

Two consequences worth naming separately:

**A visitor never waits on a database.** Not a cold one, not a warm one.

**Neon is never woken by traffic at all.** The only thing that touches the database on the public path is the ingest job. Free-tier compute hours are spent on the work that needs them.

### Tag-based revalidation, not time-based

The usual ISR configuration is time-based: `revalidate: 3600`, regenerate hourly. That is a guess, and it is wrong in both directions simultaneously — for six days it regenerates pages whose data has not changed, and for up to an hour after an ingest it serves stale data.

This system does not have to guess. **The ingest job knows exactly when the data changed**, because it is the thing that changed it.

```ts
// last step of the cron handler, after COMMIT
revalidateTag('race');
revalidateTag('standings');
```

Pages are tagged at render time; the ingest invalidates the tags it affected. Result:

- **Nothing is stale for longer than it takes to write the rows.**
- **Nothing regenerates while nothing has changed.**

### The ordering is the whole design

```
fetch → transform → upsert in a tx → COMMIT → revalidateTag(...)
```

Revalidation is **the last step, after the transaction commits**. Never before.

The reasoning is a small case study in failure-mode thinking. If revalidation came first and the ingest then failed, the cache would be dropped and not replaced. The next visitor gets a cache miss, triggers a render, and sees whatever partial or unchanged data is in the database — having lost a page that was working perfectly.

**A failed ingest should leave the site exactly as it was.** Revalidating last is what guarantees that: the failure path never touches the cache. Document 03's transaction boundary and this ordering are the same principle applied at two layers — *a failure must not degrade a working system.*

### The manual escape hatch

The admin panel's `triggerIngest` mutation runs the same code path and therefore performs the same revalidation. There is no separate "clear the cache" button, because there is no situation where clearing the cache is the actual goal — the goal is always "make the site reflect the current data", and that is what an ingest does.

### Verification

> **Step 7:** load a race page twice on a deployed build. The second response is an ISR cache hit (`x-vercel-cache: HIT`) and the Neon query log shows no query for it. Then trigger an ingest and confirm the page reflects the new data on the next load.

Two halves, deliberately. The first proves the cache is working; the second proves invalidation is working. A cache that never invalidates passes the first check alone, which is why both are written down.

---

## Part 2 — Auth

### The scope, which is the whole reason this is simple

**There is exactly one account: the admin's.** No public signup, no email verification, no password reset, no OAuth, no roles.

Public pages have **no auth code at all** — not a check that passes, but no code.

That scope is what makes Auth.js with a credentials provider roughly fifty lines, replacing v1's entire auth module. v1 rewrote authentication **three times** across three mutually-divergent branches, and the post-mortem's root cause was not incompetence — it was that auth was never *decided*, so each new requirement triggered a re-architecture. Deciding the scope first is what makes the implementation small.

```ts
// src/auth.ts — Auth.js v5, credentials provider
export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Credentials({
    authorize: async ({ email, password }) => {
      const user = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (!user) return null;
      return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
    },
  })],
  session: { strategy: 'jwt' },
});
```

**JWT sessions, no session table.** With one user there is nothing to gain from database sessions — no need to revoke another user's session, no need to list active sessions — and a JWT means the middleware can validate without a database round trip on every admin page load.

### Three layers, three jobs

```
middleware.ts        → /admin/:path*   redirects unauthenticated requests to /login
resolver context     → admin fields    throw Unauthorized (document 04, Part 6)
seed script          → creates the one user, hashing at write time
```

The middleware guards **pages**. The resolvers guard **data**. Both are necessary and neither substitutes for the other: `/api/graphql` is one URL serving both public and admin operations, so no route-level rule can express the distinction. Middleware alone would leave admin data reachable by anyone who can POST.

### The `admin123` rule

v1 shipped this on a branch:

```ts
process.env.ADMIN_PASSWORD ?? 'admin123'
```

**The `??` is the bug, not the string.** A missing environment variable — a new deployment, a renamed variable, a preview environment — silently produces a working login with a guessable password, and nothing anywhere reports a problem. The application behaves *better* when misconfigured, which is exactly backwards.

The v2 rule, without exceptions:

> **No credential defaults anywhere in the source.** A missing `ADMIN_PASSWORD` is a startup failure, not a fallback.

Verification step 5 checks it mechanically:

```bash
grep -ri "admin123\|password.*??" src/     # must return nothing
```

That grep is in the verification list because a rule with no check is a preference. It is cheap enough to run on every review.

The admin user is created by a seed script that reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment and hashes at write time. **A plaintext password exists nowhere**, including in the seed script's own source.

### The cron endpoint

`POST /api/cron/ingest` is protected by a `CRON_SECRET` header — not by a session, since no user is involved. Verification step 6: the call with the header succeeds, the call without it returns **401**.

---

## Part 3 — Testing: PGlite and the shape of the suite

### The problem with "a seeded test database"

An earlier draft of this design said tests would run against a seeded test database, which is what most projects say and is not actually a decision. It leaves open: seeded where, by whom, and how does CI get one?

The usual answers are all unsatisfying. A **shared cloud database** makes tests order-dependent and mutually destructive when two CI runs overlap. **Docker Postgres in CI** means a service container, a health check, and a startup delay on every run. **Mocking the database** tests the mock rather than the queries — and for a system where the *constraints are load-bearing* (document 02, Part 8), a mock removes precisely the thing worth testing.

### PGlite

**PGlite is real Postgres compiled to WebAssembly, running in-process.**

Not a Postgres emulation. Not SQLite with a compatibility shim. The actual Postgres engine, in the test process, with no server, no network, and no Docker.

```ts
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

beforeEach(async () => {
  const client = new PGlite();                 // fresh in-memory database
  db = drizzle(client);
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});
```

Every consequence of this matters:

- **A fresh database per suite.** No cleanup, no ordering, no leakage between tests.
- **The real migrations run.** So the tests exercise the actual schema, and a broken migration fails the test run — the migrations get tested for free.
- **Real constraints.** A test that violates `race_positions (race_id, lap, position)` fails exactly as production would. Given how much correctness this project delegates to constraints, that is not a nice-to-have.
- **No Docker, no network, no service container.** CI is `pnpm test`.
- **Fast enough** that a large suite stays worth running on every save.

### What is tested where

```
lib/ingest/transform.ts   Vitest, pure functions, saved OpenF1 fixtures — no DB at all
GraphQL resolvers         Vitest via execute() against PGlite
one Playwright test       load a race page, press play, assert positions changed
```

Three levels, and the split follows the architecture rather than a testing-pyramid diagram.

**`transform.ts` needs no database** because it is the functional core (document 03, Part 1). Its tests are the fixture suite built from the races that actually broke — the highest-value tests in the project, and the ones v1's architecture made impossible to write.

**Resolvers go through `execute()`** — the same entry point server components use (document 04). So the tests exercise the real schema, the real resolvers, the real DataLoaders, and real SQL. Not a unit test of a resolver function in isolation; an integration test of the data layer.

**One Playwright test, deliberately.** Load a race page, press play, assert positions changed. Enough to catch "the whole thing is broken"; not so much that the suite becomes a maintenance burden of its own. E2E tests are the most expensive to keep working, so one that covers the critical path is a better trade than twenty that cover everything.

### No Sentry

The failure modes that actually matter here are covered without it:

- A page error appears in **Vercel logs**.
- A failed or missing ingest appears in **`ingest_runs`** (document 02, Part 6).

The dangerous failure in this system is not an exception — it is **a cron job that quietly stopped working**, and that produces no exception anywhere. `ingest_runs` catches it and Sentry would not.

---

## Part 4 — Migrations: the workflow, and the trap it avoids

### Where migrations run

**A GitHub Action, on merge to `main`.** Not the Vercel build command.

```yaml
# .github/workflows/migrate.yml
on:
  push:
    branches: [main]
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
      - run: pnpm drizzle-kit migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Why not the build command

Running `drizzle-kit migrate` in the Vercel build is the common shortcut, and it has two failure modes that are both severe and both non-obvious.

**Preview builds would migrate production.** Every pull request triggers a Vercel preview build. Those builds share the production `DATABASE_URL` unless a separate branch database is configured. So opening a PR with a destructive migration applies it to production *before the PR is reviewed*. The migration runs at the moment of least scrutiny, from a branch nobody has approved.

**Concurrent builds race.** Two merges close together produce two builds, two `drizzle-kit migrate` invocations, and two processes attempting the same DDL against the same database. The outcomes range from a spurious failure to a partially-applied migration.

The Action avoids both: **one trigger** (merge to `main`), **one runner**, **after CI has passed**, and independently of whatever Vercel is doing.

### The ordering that follows

```
PR opened      → CI: lint, typecheck, test (PGlite)     ← no production database touched
PR merged      → migrate.yml applies migrations          ← one runner, reviewed code
merge to main  → Vercel builds and deploys               ← independent
```

Migrations land before the deploy that needs them. Since migrations should be additive, a brief window where the new schema is live and the old code is running is harmless — which is the reason to prefer additive migrations in the first place.

### The rule with no exceptions

`src/db/schema.ts` is hand-written and is the source of truth. `drizzle-kit generate` produces SQL; it is committed and reviewed like code.

**`drizzle-kit pull` is never run.** That command reads the live database and rewrites the schema file — the round-trip that mangled v1's Prisma schema and left `dev` carrying models with no migration behind them. One direction only.

Verification step 1: `pnpm drizzle-kit generate` against a clean checkout produces **no diff**. A diff means schema and migrations disagree, which is the v1 failure caught automatically instead of six months later.

---

## Part 5 — Quality gates

Each of these exists because of a specific v1 failure. That is the standard for including one — not "best practice", but *this prevented something that actually happened*.

| Gate | The v1 failure it prevents |
|---|---|
| `typecheck && lint && test` on every PR, branch protection on `main` | Broken code merged, then discovered later |
| Vitest on `transform.ts` + resolvers against PGlite | ~1,100 lines of untested import logic, silently wrong for months |
| Migrations from a GitHub Action | Schema drift; `dev` carrying models with no migration |
| `graphql-codegen --check` in CI | A resolver change breaking a client query in production |
| One Playwright smoke test | Shipping a race page that does not play |
| `.gitignore` covering `*.db`, `temp*`, `*.local` | `temp.json`, `fix-lint.js`, `dev.db`, `test-db.js`, `check-races.ts` committed |
| No stray scripts at repo root — `scripts/` or uncommitted | The same |
| `grep -ri "admin123\|password.*??" src/` | The credential backdoor on `feature/supabase` |

### Branch flow

**`feature/*` → `dev` → `main`.**

`dev` is the preview environment and deploys against a Neon branch database. `main` is production and deploys against the production database. A change is merged twice: once into `dev`, once into `main`.

> **This reverses an earlier decision.** The original flow was `feature/*` → `main` with nothing in between, on the grounds that v1's `dev` → `preprod` → `change` chain is where three mutually-divergent auth implementations came from. That reasoning still holds for a *chain* of long-lived branches, and it is why there is exactly one intermediate branch here rather than three.

What changed is the database. Vercel builds every pull request against whatever `DATABASE_URL` the project holds, so with a single database a PR carrying a destructive migration applies it to production **before the PR is reviewed** — the hazard named in Part 4. Splitting the flow gives that migration somewhere disposable to land first: `dev` writes to a Neon branch, which can be reset from production at any time.

Per-PR preview deploys still exist and are still the place a single change is reviewed. `dev` answers a different question — whether several merged changes hang together — and gives a stable URL that is safe to show someone.

**The failure mode to watch is drift.** `dev` and `main` diverge the moment something is merged into `main` without going through `dev`, and a hotfix under time pressure is exactly when that is tempting. The rule has no exceptions: everything reaches `main` through `dev`, and `dev` is deleted and re-cut from `main` if the two ever disagree. There is no reconciliation procedure, because a single developer maintaining one is how v1's three auth implementations survived as long as they did.

---

## Part 6 — The milestones

### M0 — Foundation

New repo, Next.js + TypeScript + Tailwind, Neon project, Drizzle configured, **schema written by hand**, first migration generated and applied, seed script for seasons/teams/drivers. Vercel connected, preview deploys working.

> **Done when:** `pnpm dev` runs against Neon and a seeded driver renders on a page.

A deliberately thin vertical slice — database to page — that proves the whole chain is connected before anything is built on it.

### M1 — Ingest

`lib/ingest/*` with `transform` unit-tested against saved OpenF1 fixtures. `scripts/backfill.ts` imports the full 2025 season. `ingest_runs` records every attempt.

> **Done when:** every 2025 meeting and its sessions (grand prix + sprints) are in the DB with correct per-lap positions and final classifications; the backfill completes a full season in one run without tripping the 30 req/min ceiling; and re-running it changes no row counts.

The full-season requirement is doing real work (document 03, Part 8): it forces sprint weekends, red flags, DNS/DNF, mid-season driver swaps, and short classifications to arrive **now**, when the ingest is the only thing that can be wrong.

### M1.5 — GraphQL layer

Pothos builder, core types, `races`/`race`/`seasons` with cursor pagination, Yoga mounted, `execute.ts`, DataLoaders, codegen wired. GraphiQL and introspection dev-only; depth and cost limits on everywhere. Resolver tests against PGlite.

> **Done when:** the same query returns identical data through GraphiQL and through a server component, and loading a race issues a bounded number of SQL queries — verified in the Neon query log, not assumed.

**Implemented by hand, not generated.** The working agreement is explicit about this: writing the naive resolver, watching the query count explode, and fixing it with DataLoader is the milestone.

### M2 — Public replay

Port `race-visualization/*` from v1 — canvas, player, controls, replay-state, race-car, live-timing-tower, circuit-info-panel, race-story-panel — plus `components/ui/*` and `lib/circuit-data.ts`.

**The rendering code ports near-verbatim; the data contract does not.** v1 threaded race data down through props across seven components. v2 defines one fragment — `RaceReplayFragment` — that the page requests and the player consumes as a single typed object. Rewrite the component signatures to take that shape; leave the SVG, animation, and layout logic alone.

That is the right seam: v1's animation work was its strongest part and its prop threading was its weakest. Port the strength, re-cut the weakness.

> **Done when:** a race replays end to end at portfolio quality — and does so at **390px width**, with the player controls **operable by keyboard alone**, and the **timing tower reachable as the canvas's text alternative**.

Those three are acceptance criteria here rather than M4 polish for a specific reason: **they are cheap to design in and expensive to retrofit.** Responsive layout and keyboard event handling are structural decisions in a canvas-based player, not styling passes. And a phone is the state most people will first open this in — a portfolio site that only works on a desktop fails for most of its audience.

The timing tower as text alternative is the elegant part: a canvas animation is inherently inaccessible, but the same data already exists as a table, so the accessible version is a component that has to be built anyway.

### M3 — Admin + cron

Auth.js, middleware guard, mutations (`triggerIngest`, `setRaceFeatured`, `updateRaceMetadata`) with session checked in resolver context. Admin pages: race list, trigger/re-run import, view `ingest_runs`, toggle featured, edit metadata. `POST /api/cron/ingest` wired to the `vercel.json` schedule.

**Deliberately thinner than v1.** Cron does the bulk work, so full CRUD over every driver, team, and position row is not rebuilt. v1 had it, and it was maintenance burden for capability that was never used — the admin's real job is *observing that ingest worked* and *re-running it when it did not*.

### M4 — Polish and ship

Standings page reading the derived `driverStandings` / `constructorStandings` resolvers (port `standings-view.tsx` and `wikipedia-image.tsx`), SEO (sitemap, robots, per-race OG images), loading skeletons, dark theme, error boundaries. Image attribution on `/about` — headshots originate from Wikipedia (CC BY-SA) and OpenF1. Custom domain.

### Deferred, not cut

**Public accounts** — Auth.js gains OAuth providers, the `users` table grows.

**Armchair Strategist** — a prediction game: call the winner and the pit strategy, scored against what actually happened. Note that this one is **built, not ported**: no strategist code survives on any archived v1 branch, only orphaned `Prediction` and `RaceScore` Prisma models on `dev` with no migration behind them. A feature that existed as two model definitions and nothing else.

Both slot into the existing schema as **new types and mutations**, not new endpoints — which is the concrete demonstration of why the GraphQL layer was worth building.

---

## Part 7 — The verification list

Ten checks, each tied to a design claim. This is the list to run before calling anything done.

| # | Check | The claim it tests |
|---|---|---|
| 1 | `drizzle-kit generate` produces no diff on a clean checkout | Schema and migrations agree — **the exact check v1 failed** |
| 2 | Backfill a session twice; row counts identical, two `SUCCESS` rows | Idempotency |
| 3 | GraphiQL output matches the server component's render; Neon query count is bounded | One schema two transports; DataLoader is wired |
| 4 | Play a race — positions animate, tower matches canvas, events on the right lap | The replay is correct end to end |
| 5 | `/admin` logged out redirects; `grep -ri "admin123\|password.*??" src/` is empty | Auth works; no credential default exists |
| 6 | Cron with `CRON_SECRET` succeeds; without it returns 401 | The endpoint is not public |
| 7 | Second page load is `x-vercel-cache: HIT` with no Neon query; ingest updates it | ISR caches **and** invalidates |
| 8 | Derived 2025 standings match the published final championship | **The strongest end-to-end proof in the project** |
| 9 | Introspection fails in production, succeeds in dev; over-nested query rejected | Hardening is on |
| 10 | Push a branch; the preview URL builds and serves a working replay | Deployment works |

**Step 8 deserves its label.** One number per driver — the season points total — simultaneously exercises the `/position` ↔ `/laps` join, sprint scoring, post-race penalties, DNF classification, the assignment model, and the standings aggregate. If that table matches, essentially everything upstream of it is right. It is one manual comparison against a published table, and it is worth more than any test in the suite.

---

## The through-line

Read the five documents together and one idea recurs at every layer:

| Layer | The same idea |
|---|---|
| **Schema** | Constraints make wrong data unstorable |
| **Ingest** | Purity makes wrong logic testable; transactions make partial writes impossible |
| **API** | Codegen makes a broken query a compile error |
| **Delivery** | Revalidating last makes a failed ingest harmless |

> **Make the correct behaviour structural, so it cannot be omitted.**

Every one of those replaces something a developer would otherwise have to *remember*. v1's failures were not failures of skill — they were the accumulated cost of correctness that depended on remembering, under deadline, three months later, on a branch.

That is what the design is for.

---

*End of the whiteboard set: 00 Principles & Patterns · 01 System Overview · 02 Data Model · 03 Ingest Pipeline · 04 API Layer · 05 Delivery.*
