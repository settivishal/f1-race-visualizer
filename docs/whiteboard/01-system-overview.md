# 01 · System Overview & Architecture

*What the system is, what constrains it, and why it is shaped the way it is.*

---

## What it does

A Formula 1 race replay platform. You pick a race and watch it unfold as an animated position
chart: twenty cars moving between positions lap by lap, with overtakes, pit stops, safety cars,
and retirements appearing at the lap they actually happened. Alongside it, a race library you
can search and filter, and championship standings.

That is the whole product. It is worth writing down, because a clear scope is what lets you say
no later.

---

## The constraints — the real drivers of every decision

Architecture is downstream of constraints. State them first and most decisions stop looking
like preferences:

| Constraint | Consequence |
|---|---|
| **One developer** | Every service is a service someone maintains alone. Splits must earn themselves. |
| **Portfolio traffic** | Tens of visits a day, not thousands a second. Scaling is not the problem. |
| **Near-zero budget** | Free tiers only. Which makes free-tier *limits* into architectural inputs. |
| **The demo must always work** | A recruiter opening a broken page is the worst outcome. Uptime beats freshness. |
| **It should teach something** | This is also a learning artefact, so one decision is allowed to be a learning goal — declared as such. |

The fourth constraint is the sharpest. It is why no external API is ever touched during a page
request, and why the site is designed to render correctly even if every upstream service is
down. A demo that depends on someone else's uptime is a demo that will eventually embarrass you
in front of exactly the person you built it for.

The third constraint is more architectural than it first appears. "Free tier" is not a budget
line, it is a set of hard technical limits: Neon autosuspends when idle, Vercel Hobby runs cron
at most once a day, OpenF1 allows 30 requests a minute. Each of those shaped a real decision.

---

## Where this design came from: the v1 post-mortem

v2 is a rewrite, and it is worth being precise about why — because "the old one was messy" is
not a reason, and the actual reason determines what to do differently.

**v1 worked.** It shipped. It replayed races. The animation was good.

**What went wrong was structural:**

- **Prisma schema drift.** `Prediction` and `RaceScore` models existed in `schema.prisma` with
  no corresponding migration. The schema and the database disagreed, and nothing detected it.
- **The schema had been overwritten by `prisma db pull`.** Hand-authored comments were lost and
  relations came back with machine names like
  `Prediction_Prediction_predictedWinnerDriverIdToDriver`.
- **A hardcoded `admin` / `admin123` login backdoor** on a feature branch, with no environment
  guard, bypassing authentication entirely.
- **Committed junk:** `temp.json`, `fix-lint.js`, `dev.db`, `test-db.js`, `check-races.ts`.
- **20+ branches**, three of them mutually divergent on how authentication worked.

**The root cause was a single thing:** auth, data flow, and deployment were never decided up
front. So each was rewritten under pressure — authentication three separate times, cookies to
Bearer tokens to Supabase — and each rewrite left sediment behind that the next one had to work
around.

**Therefore v2's first act was to decide, and write it down.** That is what the design document
and the decision log are for, and it is why implementation did not begin until they existed.

**v1 is not discarded.** It is the reference implementation. The replay rendering, the circuit
geometry, and the OpenF1 import knowledge are ported from it rather than reconstructed from
memory. Throwing away working animation code to prove a point would be its own kind of mistake.

---

## The one-line architecture

> A scheduled job copies Formula 1 data into our own Postgres. Everything the user sees is
> served from that copy, through one GraphQL schema, from one Next.js application, mostly out
> of a static cache.

Every subsequent decision is an elaboration of that sentence.

---

## Decision 1 — a single Next.js application

**Chosen:** one deployable. Route handlers and server components. No separate API service.

**Rejected:** v1's Next.js + NestJS split; adding tRPC.

**Reasoning.** v1's split forced CORS configuration, a custom `x-web-origin` header, and
duplicated token plumbing at every boundary — for one developer serving portfolio traffic. The
separation created a seam that nothing consumed. There was no second client. There was no
separate scaling profile. There was no other team.

In a single app, a server component queries the database directly and the race page renders
with no HTTP hop at all. The network call between frontend and backend — with its latency, its
serialization, its failure modes, and its configuration — simply stops existing.

**The counter-argument, answered honestly:** what if a mobile client or a public API is needed
later? Then the GraphQL schema is already that seam. Splitting a well-layered monolith later is
a known, tractable refactor. Maintaining a premature split for years is a tax paid daily.

---

## Decision 2 — copy the data in, never fetch it live

**Chosen:** a scheduled job pulls from OpenF1 into our Postgres. No page request ever touches
an external API.

**Rejected:** live fetch with caching; a static seeded dataset; admin-triggered imports only
(v1's model).

**Reasoning.** v1 called `api.openf1.org` live on every relevant request, with no cache. That
means the site inherited, on every single page load:

- OpenF1's latency, added to ours;
- OpenF1's uptime as a hard ceiling on ours;
- OpenF1's rate limits as a ceiling on our traffic;
- OpenF1's schema changes as a source of production breakage.

Owning a copy removes all four at once. The page is fast because Postgres is close. It works
when upstream is down. It cannot be rate-limited. And an upstream change breaks an ingest run —
recorded, visible, and retryable — instead of breaking the site.

**The trade accepted:** data is as fresh as the last ingest. For a replay of a race that
finished on Sunday, "fresh as of Monday morning" is not a compromise at all.

**A design consequence worth noticing:** because ingest is the only writer, it is also the only
place that needs to understand OpenF1. That single fact is what makes the whole pipeline
testable — see document 03.

---

## Decision 3 — GraphQL as the data layer

**Chosen:** GraphQL Yoga + Pothos, code-first, at `/api/graphql`. One schema for all reads and
all admin mutations.

**Stated honestly:** this is a **learning goal, not an architectural necessity.** Server
components could query Drizzle directly and the site would be simpler.

**Why it is nonetheless a good decision.** It is made genuine by being *the* data layer rather
than a decorative veneer over three queries. Because everything goes through it, the parts
worth learning are unavoidable rather than optional: schema design, resolver composition,
DataLoader batching, cursor pagination, fragment colocation, and typed codegen. A GraphQL layer
that wraps three endpoints teaches nothing; one that carries a 1,200-row-per-race N+1 problem
teaches the thing that actually matters.

**Why Pothos, code-first.** The schema is built in TypeScript from the Drizzle models, so it
cannot drift from the database — a compile error, not a runtime null. Given that v1 died of
schema drift, choosing the tool that makes drift a type error is not a coincidence.

**Why Yoga over Apollo Server.** Lighter, and designed to run inside a route handler.

---

## Decision 4 — Postgres via Drizzle, on Neon

**Chosen:** Neon Postgres, Drizzle ORM, migrations as the only source of truth.

**Rejected:** Neon + Prisma (the known quantity); Supabase; an always-on instance.

**Reasoning.** The specific failure that killed v1 was `prisma db pull` overwriting a
hand-authored schema. Drizzle's model is one-directional: the schema is TypeScript,
`drizzle-kit generate` produces SQL migrations, migrations are committed and reviewed like
code. **There is no round-trip that can silently overwrite the model.** The hard rule is
written into the design: never run `drizzle-kit pull`.

Drizzle is also lighter on serverless cold starts, which matters when every page render might
be a cold one.

**The driver choice** is `drizzle-orm/neon-serverless` (WebSocket `Pool`), not the lighter HTTP
driver — because ingest must upsert a race, its positions, its events, and its results as one
transaction, and the HTTP driver cannot hold a multi-statement transaction. One client for both
app and scripts; two connection paths would be two things to keep straight for a little
latency.

---

## Decision 5 — static by default

**Chosen:** ISR. Pages are statically cached; the ingest job revalidates by tag when the data
actually changes.

**Reasoning.** Race data changes once a week. Rendering it per request is pure waste — and on a
free tier that waste is *visible*, because Neon autosuspends when idle and the wake-up lands on
whoever loaded the page.

With ISR, ordinary traffic never touches Postgres at all. And because the ingest job knows
precisely when data changed, it does the invalidating itself: no polling, no guessing, no
arbitrary TTL leaving a fresh race stale for an hour.

**The ordering rule that matters:** revalidation is the *last* step, after the transaction
commits. A failed ingest therefore leaves the cache serving the last good data, rather than
dropping the cache and exposing a half-written state.

---

## The four request paths

The clearest way to understand the system is to trace what happens in each of the four things
that can occur.

### 1 · Public page load — cache hit (the overwhelmingly common case)

```
browser → Vercel edge cache → HTML
```

No server component runs. No resolver executes. No query reaches Postgres. Neon stays asleep.
This is the path a recruiter takes, and it is the fastest possible one.

### 2 · Public page load — cache miss or post-ingest revalidation

```
browser → Vercel → server component → execute() → resolvers
        → DataLoader → Drizzle → Neon → HTML streamed back, and cached
```

Note what is absent: no `fetch` to our own API, no client-side data loading, no loading
spinner for the primary content. The server component executes GraphQL **in-process** — same
schema, same resolvers, no HTTP.

### 3 · Interactive widget

```
browser → POST /api/graphql → Yoga → [session check on admin fields]
        → resolvers → DataLoader → Drizzle → Neon → JSON
```

For things that genuinely need to change without a navigation: race library filters, standings
toggles, admin forms. **Not** the replay payload — that arrives as props on path 2, inside the
cached HTML.

### 4 · Scheduled ingest — no user involved

```
Vercel Cron → POST /api/cron/ingest  [CRON_SECRET]
        → read app_config → is work due?
        → fetch OpenF1 → transform → upsert one race in a transaction
        → write ingest_runs → revalidateTag(...) → 200
```

Plus a fifth, which is path 4 by hand: the admin panel's `triggerIngest` mutation runs the same
`lib/ingest` code.

**The point of the whole split:** external APIs appear exactly once, at the top, reachable only
by path 4. No page render can be slowed or broken by an upstream problem. That was v1's central
flaw, and this shape makes it structurally impossible rather than merely unlikely.

---

## The layers, and which way dependencies point

```
   PRESENTATION   app/(public), components/race-visualization, components/ui
        ↓
   API            graphql/schema, graphql/loaders, graphql/execute
        ↓
   DOMAIN         lib/ingest/transform  ← pure, depends on nothing
        ↓
   PERSISTENCE    db/schema, db/index (Drizzle → Neon)
```

**One rule: arrows point down, never up.** `transform.ts` knows nothing about GraphQL. The
schema knows nothing about React. Any cycle in that graph is a design bug, not a style
preference.

Two things sit deliberately outside the stack:

- **`lib/ingest`** is a *writer*, entering at the persistence layer and bypassing GraphQL
  entirely. That asymmetry is intentional — see the CQRS note in document 00.
- **`middleware.ts`** is a cross-cutting guard on `/admin/*` and sits beside the layers rather
  than inside them.

---

## Repository shape

```
src/
├── app/
│   ├── (public)/          /, /about, /races, /races/[slug], /standings
│   ├── admin/             guarded by middleware
│   └── api/
│       ├── graphql/       Yoga handler — the app's data API
│       ├── auth/[...nextauth]/
│       └── cron/ingest/   CRON_SECRET-protected
├── components/
│   ├── race-visualization/   ported from v1, near-verbatim
│   └── ui/                   ported from v1
├── graphql/
│   ├── builder.ts         Pothos builder + context type
│   ├── schema/            race.ts, driver.ts, standings.ts, admin.ts
│   ├── loaders.ts         DataLoader instances, one set per request
│   ├── execute.ts         in-process execution for server components
│   ├── operations/        .graphql documents used by client components
│   └── generated/         codegen output — committed, never hand-edited
├── db/
│   ├── schema.ts          Drizzle schema — hand-written, source of truth
│   ├── index.ts           Neon client (neon-serverless Pool)
│   └── migrations/        generated, committed, never hand-edited
├── lib/
│   ├── ingest/            openf1.ts, images.ts, transform.ts, run.ts
│   └── circuit-data.ts    ported from v1
└── auth.ts

.github/workflows/         ci.yml, migrate.yml
middleware.ts              /admin/* guard
vercel.json                cron schedule
scripts/backfill.ts        long imports — local or GitHub Actions
codegen.ts · drizzle.config.ts
```

Two directories are generated and never hand-edited: `db/migrations/` and
`graphql/generated/`. Both are committed, because both are contracts — a reviewer should see
them change.

---

## What is deliberately not here

- **Public user accounts.** The only account is the admin's. That removes signup, email
  verification, password reset, and an email provider from the system entirely.
- **The "Armchair Strategist" prediction game.** Deferred, and honestly labelled: no
  implementation survives on any v1 branch — only the orphaned Prisma models that *were* the
  schema drift. It gets built, not ported.
- **Error tracking (Sentry).** The failure that matters is a silent cron failure, and that is
  visible as a stale `ingest_runs` row.
- **A custom domain.** Ships on `*.vercel.app`.
- **A `dev` / `preprod` branch chain.** `feature/*` → `main`, with preview deploys per PR.

Both deferred features slot into the existing schema as new types and mutations rather than new
endpoints — which is a genuine demonstration of why the GraphQL layer was worth building.

---

**Next:** document 02 takes the database apart table by table.
