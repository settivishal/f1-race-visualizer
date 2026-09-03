# 04 · API Layer

> **Where you are:** 03 filled the database. This document is about getting data back out — the GraphQL schema, the two ways it is reached, and the N+1 problem, which is the single most valuable thing in this milestone.

---

## Part 1 — Why GraphQL is here at all

Start with the honest version, because a design document that oversells a choice is useless six months later when you are deciding whether to keep it.

**GraphQL is not architecturally necessary in this project.** Server components can query Drizzle directly. For a single-developer portfolio site with a handful of pages, a `db.query.races.findMany()` in a server component would work, ship faster, and have fewer moving parts.

**GraphQL is here because learning it properly is an explicit goal of v2.**

That framing is worth stating plainly for two reasons. First, it stops the layer from being defended on invented grounds later. Second — and more usefully — it changes *how* the layer should be built. If the point is learning, then a GraphQL veneer over a couple of queries is the worst possible outcome: all of the setup cost, none of the interesting problems.

### So it is made genuine

The rule: **GraphQL is *the* data layer, not a facade over one.** Every read in the application goes through it, including the ones from server components that could have bypassed it.

That single decision forces every part actually worth learning to appear:

| Forced to appear | Why it becomes unavoidable |
|---|---|
| **Schema design** | The replay payload has to be modelled as types, not returned as a blob |
| **Resolver composition** | Nested types resolve independently; the shape is not one query |
| **DataLoader batching** | 1,200 position rows make N+1 immediate and severe (Part 5) |
| **Pagination** | The race library needs cursors |
| **Fragments** | The player consumes exactly one, defining its own data needs |
| **Codegen** | Client operations must stay in sync with the schema |
| **Hardening** | A public endpoint has to survive hostile queries (Part 6) |

None of those can be skipped. That is what makes it a real exercise rather than a tutorial.

### Where YAGNI was deliberately overruled — and where it was not

This is the one place in the project where "you aren't gonna need it" was consciously set aside, because the goal is not only shipping. Worth noting that the rule still applies everywhere else — no Repository layer over Drizzle, no dependency-injection container, no event bus. The exception is narrow and named.

And GraphQL is **not** used where it earns nothing:

- **Ingest writes directly to Drizzle.** A 1,200-row batch write from a trusted internal process is not a client read (document 03, Part 7).
- **Cron does the same.** No schema, no resolvers, no serialization.

**Not everything is a nail.** Knowing where the tool stops applying is part of learning it.

### The forward-looking argument

There is one non-learning benefit, stated modestly. The deferred features — public accounts, the Armchair Strategist prediction game — slot in as **new types and mutations on the existing schema**, not as new endpoints with new auth and new client plumbing. That is a real property of a schema-based API, and it will be a genuine demonstration of the layer's value if those features ever land. It is not, on its own, why the layer exists today.

---

## Part 2 — One schema, two transports

Resolvers are written **once** and reached **two ways**.

```
                    ┌────────────────────────┐
                    │  GraphQL schema        │   Pothos, code-first
                    │  Query · Mutation      │   types inferred from Drizzle
                    └───▲────────────────▲───┘
      in-process        │                │      HTTP POST
      execute()         │                │
        ┌───────────────┴┐        ┌──────┴──────────────┐
        │ Server         │        │ /api/graphql        │
        │ Components     │        │ (Yoga handler)      │
        │ race page,     │        └──────▲──────────────┘
        │ library, SEO   │               │ urql + codegen hooks
        └────────────────┘        ┌──────┴──────────────┐
                                  │ Client Components   │
                                  │ replay explorer,    │
                                  │ filters, admin      │
                                  └─────────────────────┘
```

### Server components: `execute.ts`

```ts
// src/graphql/execute.ts
import { execute, parse } from 'graphql';
import { schema } from './schema';

export async function executeQuery<T>(document: string, variables?: Vars): Promise<T> {
  const result = await execute({
    schema,
    document: parse(document),
    contextValue: await createContext(),   // fresh DataLoaders per call
  });
  if (result.errors) throw result.errors[0];
  return result.data as T;
}
```

This runs `graphql.execute()` against the schema **in the same process**. No HTTP request, no JSON serialization round-trip, no `fetch('http://localhost:3000/api/graphql')`.

That last point is worth dwelling on, because calling your own API over localhost from a server component is a common and genuinely bad pattern. It costs a TCP connection, a serialization pass, a deserialization pass, and — on serverless — potentially a second cold start, all to reach code that is already loaded in memory. It also makes the page's render depend on the app's own HTTP layer being up, which is a strange thing to be uncertain about from inside that app.

**With `execute.ts`, the race page renders as fast as a direct Drizzle query would**, while still going through the schema, the resolvers, and the DataLoaders. The learning goal survives; the performance cost does not exist.

This is the **Facade** pattern doing real work. Server components know one function. They do not know whether GraphQL is involved, and if the transport ever changed they would not need to.

### Client components: urql over HTTP

Genuinely interactive surfaces POST to `/api/graphql` (a Yoga route handler) using urql with codegen-generated typed hooks:

- race library filters and search
- standings season toggles
- admin forms and mutations

### The dividing line

**Server components fetch data that is part of the page. Client components fetch data that changes because of user interaction.**

That line matters more than it looks, and Part 4 is about the biggest case where it applies.

---

## Part 3 — Schema design

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
```

### The schema mirrors the domain, not the tables

`Race` has a `meeting`, and `Meeting` has `races`. A `DriverStanding` has a `driver` and a `team`. Those are domain relationships. The fact that `race_positions.assignment_id` points at a join table (document 02, Part 3) never appears in the schema at all — a client asks for `position.driver` and the resolver walks the assignment for it.

**A schema that mirrors your tables is a REST API with extra steps.** The value is in exposing the domain and letting the storage shape stay a private matter.

### `RaceReplay` — one type, shaped for its consumer

```graphql
type Race {
  id: ID!  slug: String!  type: RaceType!  date: DateTime!
  laps: Int!  isFeatured: Boolean!
  meeting: Meeting!                        # name, country, circuit, weather live here
  replay: RaceReplay!                      # the replay payload, driver-centric
  positions(lap: Int): [RacePosition!]!    # flat per-lap slice, for the timing tower
  events(lap: Int): [RaceEvent!]!
  results: [RaceResult!]!
}

# One object per race, shaped the way the ported v1 components already consume it.
type RaceReplay {
  summary: ReplaySummary!                  # lapCount, maxLap, maxPosition, driverCount
  laps: [Int!]!
  drivers: [ReplayDriver!]!                # each with its own position series
  events: [RaceEvent!]!
}
```

Notice the deliberate redundancy: `replay` and `positions` expose overlapping data in **two different shapes**, and that is correct.

The database stores positions **flat** — one row per driver per lap (document 02). The timing tower wants exactly that, sliced by lap. But the replay player wants them **pivoted by driver**: each driver with their own series across the race, because that is what an animation interpolates along.

Serving only the flat list would force the client to re-pivot ~1,200 rows into 20 series **on every render**. That is real work on a phone, in a `requestAnimationFrame` loop, repeatedly, for a transformation whose output never changes.

So the pivot happens **once, on the server**, in a resolver. This is a genuine use of GraphQL: *the API serves the shape the consumer needs, not the shape the database happens to have.*

`ReplaySummary` follows the same logic — `maxLap`, `maxPosition`, and `driverCount` are trivially derivable, but every consumer needs them and deriving them client-side means twenty components each computing the same number.

### The interface-segregation angle

`RaceReplayFragment` is what the player consumes, and it is deliberately narrower than `Race`. The player never sees `isFeatured`, `results`, or `meeting.weather` — it declares its own data needs, and those needs are checked by the compiler through codegen.

That is the Interface Segregation Principle with a build step behind it. In v1, components received the whole race object as a prop and each one depended on the entire shape; changing any field risked breaking any of them.

### Standings are types, not blobs

```graphql
type DriverStanding {
  position: Int!  driver: Driver!  team: Team!
  points: Float!  wins: Int!  podiums: Int!
}

type ConstructorStanding {
  position: Int!  team: Team!  points: Float!  wins: Int!
}
```

Two separate queries — `driverStandings` and `constructorStandings` — rather than one `standings(season, type)` returning a union or an untyped payload.

The earlier draft had exactly that single query with a `type` argument, and it was replaced. A driver standing has a `driver` and `podiums`; a constructor standing has neither. Forcing them through one type means nullable fields that are *always* null for one of the two cases, and clients writing `standing.driver!` with a comment explaining when it is safe.

**Two queries, two honest types.** The resolvers compute both from `race_results` (document 02, Part 5) — nothing is stored.

`position` is the rank from the ordered result, computed in the resolver. Never a column.

---

## Part 4 — Where the replay payload actually travels

A design question that is easy to get wrong, and the answer is not the obvious one.

**The race page is a server component.** It runs the `RaceReplayFragment` query through `execute.ts` and passes the result to the client player **as a prop**.

```tsx
// app/(public)/races/[slug]/page.tsx  — server component
export default async function RacePage({ params }) {
  const { race } = await executeQuery<RaceQuery>(RACE_REPLAY_QUERY, { slug: params.slug });
  return <ReplayPlayer replay={race.replay} />;   // client component, data as prop
}
```

### Why not fetch it from the client with urql

The alternative — render the page shell, then have the player fetch its own data via urql — is the reflexive choice, and it is worse here in three specific ways.

**It creates a fetch waterfall.** The browser downloads HTML, parses it, downloads JS, hydrates, *then* issues a query, then waits. Roughly a full extra round trip before anything can be drawn, on a payload of ~1,200 rows.

**It is uncacheable.** A client-side fetch happens per visitor, every visit. Server-rendered data is **inside the ISR-cached HTML** — served from the edge, no database touched (document 05).

**It needs a loading state and an error state** for data that is already known at render time. That is real UI code that exists only because of the fetching choice.

Passing the payload as a prop means the data arrives **inside the streamed HTML**, on the first response, already cached.

### The general rule

> **urql is for genuinely interactive surfaces only** — race library filters, standings toggles, admin forms. Data that is *part of the page* is server-rendered.

The test: *does this data change in response to something the user does after the page loads?* If no, it belongs in the server render. Most data fails that test, which is why "fetch everything from the client" is the more common mistake than the reverse.

---

## Part 5 — N+1, developed properly

This is the centre of M1.5. Everything else in the milestone is scaffolding around understanding this.

### What GraphQL actually does when it resolves a query

A resolver runs **per field, per object**. Not per query. That single fact is the whole problem.

```graphql
query {
  race(slug: "2025-sao-paulo") {
    positions {          # resolver runs once → returns ~1,200 rows
      lap
      position
      driver {           # resolver runs ~1,200 times, once per row
        name
        team { name color }   # and again per driver
      }
    }
  }
}
```

The `driver` resolver has no idea it is one of 1,200 calls. It receives one position row and is asked for one driver. Written naively:

```ts
driver: t.field({
  resolve: async (position, _args, ctx) => {
    const assignment = await ctx.db.query.driverTeamAssignments
      .findFirst({ where: eq(driverTeamAssignments.id, position.assignmentId) });
    return ctx.db.query.drivers
      .findFirst({ where: eq(drivers.id, assignment.driverId) });
  },
}),
```

Perfectly reasonable code. Correct code. And it produces:

| Step | Queries |
|---|---|
| Fetch the race | 1 |
| Fetch its positions | 1 |
| Resolve `assignment` per position row | 1,200 |
| Resolve `driver` per assignment | 1,200 |
| Resolve `teamSeason` per assignment | 1,200 |
| Resolve `team` per teamSeason | 1,200 |
| **Total** | **~4,800** |

**Roughly 4,800 SQL queries to render one page.** Against Neon — a serverless Postgres, over the network, per query — that is not slow, it is unusable. Tens of seconds at best.

### Why the naive version looks fine in development

Two reasons this survives review, both worth knowing.

**It is correct.** Every query returns the right answer. The page renders the right data. Nothing errors.

**It scales invisibly.** With one race, three drivers, and five laps in a dev database, that is 60 queries against a local Postgres — a few milliseconds. Nothing suggests a problem. The failure appears only at production data volume, against a production database, over a network. Which is to say: it appears in front of a user, not in front of you.

### What is actually wrong

Look at those 1,200 driver lookups. There are twenty drivers in the race. **The same twenty rows are being fetched sixty times each.**

That is the entire insight. The problem is not that GraphQL issues many queries; it is that it issues the *same* queries repeatedly, because each resolver call is unaware of its siblings.

Two distinct wastes:
1. **Duplication** — the same driver fetched sixty times.
2. **Fragmentation** — twenty distinct lookups sent as twenty round trips instead of one `WHERE id IN (...)`.

DataLoader solves both.

### How DataLoader works

Two mechanisms, and they are separable ideas.

**Batching.** Instead of issuing a query immediately, a loader collects every `.load(id)` call made during the current tick of the event loop, then issues **one** query for all of them.

```ts
// src/graphql/loaders.ts
export const createLoaders = (db: Db) => ({
  driverById: new DataLoader<string, Driver>(async (ids) => {
    const rows = await db.select().from(drivers).where(inArray(drivers.id, [...ids]));
    const byId = new Map(rows.map(r => [r.id, r]));
    return ids.map(id => byId.get(id));      // MUST match input order
  }),
  teamById:       new DataLoader(/* … */),
  assignmentById: new DataLoader(/* … */),
});
```

That `ids.map(...)` line at the end is not incidental. DataLoader's contract is that the returned array is **the same length and the same order** as the requested keys, because that is how it maps results back to the callers waiting on them. Returning the database's rows directly — which come back in arbitrary order and omit missing ids — silently hands driver A's data to the caller who asked for driver B. It is the classic DataLoader bug and it produces *wrong data*, not an error.

**Caching (Identity Map).** Within one loader instance, a key is fetched at most once. The sixty requests for the same driver collapse to one, and the other fifty-nine get the cached object.

### The result

| Step | Queries |
|---|---|
| Fetch the race | 1 |
| Fetch its positions | 1 |
| `assignmentById` — 20 unique ids, batched | 1 |
| `driverById` — 20 unique ids, batched | 1 |
| `teamSeasonById` — 10 unique ids, batched | 1 |
| `teamById` — 10 unique ids, batched | 1 |
| **Total** | **~6** |

**~4,800 → ~6.** And critically, that number is **bounded by the number of entity types, not by the number of rows**. A 78-lap Monaco race with 20 drivers issues the same six queries as a 44-lap sprint.

### Per request, not global — and why that is not negotiable

```ts
// The context factory creates a fresh set for every request.
export async function createContext(req?: Request) {
  return { db, loaders: createLoaders(db), session: await auth() };
}
```

The loaders' cache is the reason. A module-level loader would cache a driver's row **for the lifetime of the process**, so an admin editing a driver's name would see the old value until the serverless instance recycled — a cache with no invalidation and an unbounded lifetime, which is a memory leak and a staleness bug in one.

Per-request scoping makes the cache lifetime exactly the window in which the data cannot change anyway. **The cache is correct because it is short-lived, not because anything invalidates it.**

This applies to `execute.ts` too: each call creates its own context, so a server render gets its own loaders and never shares them with a concurrent render.

### Verifying it — the part that is not optional

> **Watch the Neon query log while loading one race.** The query count must be bounded (roughly one per entity type), not proportional to driver count.

This is Verification step 3, and it is written as an instruction to *look* rather than to assume for a reason. A missing DataLoader produces no error and no visible symptom in development. The **only** way to know it is wired is to count the queries.

M1.5's acceptance criterion says the same thing in stronger terms: *verified in the Neon query log, not assumed.*

### Why do this by hand

The working agreement is explicit: **M1.5 is implemented by hand, not generated.** Pothos has plugins that can wire batching automatically. Using one would produce working code and teach nothing.

Writing the naive resolver, watching the query log explode, adding the loader, and watching it collapse to six is the entire point of the milestone. The bug is more valuable than the fix.

---

## Part 6 — Hardening

`/api/graphql` is **public and unauthenticated**. Public queries need no session, which is correct — the site is a public site — and it means anyone can send arbitrary queries to it.

An open GraphQL schema is an unusual kind of exposure, because the client gets to choose the *shape* of the work the server does. Two attacks follow directly from the schema in Part 3.

### Attack 1 — cyclic queries

The schema has a cycle: `Race → Meeting → races → Meeting → races → …`

```graphql
{ race(slug:"x") { meeting { races { meeting { races { meeting { races {
  meeting { races { meeting { races { id } } } } } } } } } } } }
```

A short query. Exponential work. No authentication required, no unusual tooling, no knowledge of the codebase beyond what introspection would hand over.

**Mitigation: a depth limit of ~10.** Legitimate queries in this application nest three or four levels. Ten is generous and closes the class entirely.

### Attack 2 — expensive payloads

`race { replay }` is ~1,200 rows and a pivot. Perfectly legitimate as a page load; a cheap way to consume a server when requested in a loop, or aliased fifty times in a single request:

```graphql
{ a: race(slug:"x") { replay { drivers { positions } } }
  b: race(slug:"y") { replay { drivers { positions } } }
  # … × 50, one HTTP request
}
```

**Mitigation: a cost limit.** Fields are assigned complexity, list fields are multiplied by their size, and a query exceeding the budget is rejected before execution.

### Both as envelop plugins, always on

```ts
const yoga = createYoga({
  schema,
  plugins: [
    useDepthLimit({ maxDepth: 10 }),
    useCostLimit({ maxCost: 5000 }),
    ...(isDev ? [] : [useDisableIntrospection()]),
  ],
  graphiql: isDev,
});
```

**Always on, in every environment.** Not "production only" — a limit that is off in development is a limit nobody notices they have broken until it rejects a legitimate query in production.

### Introspection and GraphiQL: development only

Introspection lets a client download the entire schema. GraphiQL is a full query IDE.

In development both are genuinely valuable — GraphiQL against a real database is one of the better parts of working with GraphQL, and Verification step 3 explicitly uses it to compare GraphiQL output against a server component's render.

In production they hand an attacker a complete map of every type, field, and mutation, including the admin ones. The admin mutations are still authorization-checked, so introspection is not itself a breach; it is reconnaissance, and there is no reason to provide it.

**Cost of all of this: roughly fifteen lines.** It closes two whole classes of attack and removes the reconnaissance surface, while keeping ad-hoc querying exactly where it is useful. Verification step 9 checks it from the outside: an introspection query against production must fail, the same query in dev must succeed, and an over-nested query must be rejected.

### Authorization is in the resolver, not the route

```ts
builder.queryField('ingestRuns', (t) => t.field({
  type: [IngestRun],
  resolve: async (_root, args, ctx) => {
    if (!ctx.session?.user) throw new GraphQLError('Unauthorized');
    return ctx.db.query.ingestRuns.findMany({ /* … */ });
  },
}));
```

Route-level protection cannot work here: `/api/graphql` is **one endpoint serving both public and admin operations**. There is no URL to guard. The unit of authorization in GraphQL is the field, so that is where the check goes.

The context factory reads the Auth.js session once per request; each admin field checks it. Public queries never look.

**The failure mode to watch:** a new admin field added without a check is silently public, and nothing in the type system notices. The mitigation is convention plus review — admin fields live together in `schema/admin.ts` so that "does every field in this file check the session?" is a question one file can answer.

---

## Part 7 — Codegen as a build-time contract

```ts
// codegen.ts
export default {
  schema: './src/graphql/schema.ts',
  documents: './src/graphql/operations/**/*.graphql',
  generates: {
    './src/graphql/generated/': { preset: 'client' },
  },
};
```

Two things are generated: **TypeScript types from the schema**, and **typed hooks from the client operations**. Output is committed and never edited by hand.

### What this buys

A client component asking for a field that no longer exists is a **compile error**, not a runtime `undefined`.

That is the entire value, and it is larger than it sounds because of *when* it fires. The dangerous change is renaming or removing a schema field. Without codegen, every client operation referencing it keeps parsing, keeps sending, and starts receiving `null` — which surfaces as a blank area of the UI, in production, possibly weeks later, in a component nobody thought was related.

`graphql-codegen --check` runs in CI. **A resolver change that breaks a client query fails the build rather than production.**

### The type flow

Note that types flow the whole way through without a hand-written interface anywhere:

```
Drizzle schema (hand-written, source of truth)
      ↓ Pothos infers model types
GraphQL schema
      ↓ codegen
TypeScript types + typed hooks
      ↓
Components
```

Pothos is code-first, so the schema is TypeScript that knows about the Drizzle models. A column rename propagates to a type error in a component. **There is no point in that chain where a human retypes a shape**, which means there is no point where the two can silently disagree — the failure mode that produced v1's Prisma drift, one layer up.

---

## Part 8 — M1.5's acceptance criteria

> **Done when:** the same query returns identical data through GraphiQL and through a server component, and loading a race issues a bounded number of SQL queries — verified in the Neon query log, not assumed.

Two clauses, two properties.

**The first proves the two transports share one implementation.** If GraphiQL and the server component disagree, then `execute.ts` is not running the same schema, or the context differs between them, and there are effectively two APIs to maintain. The whole "one schema, two transports" claim rests on this check.

**The second proves DataLoader is wired**, and the phrase *not assumed* is load-bearing. Nothing about a missing loader is visible from the outside. The page renders, the data is right, and the only symptom is a number in a log that you have to go and look at.

The rest of M1.5: Pothos builder, the core types, cursor pagination on `races`, Yoga mounted, `execute.ts`, loaders, codegen wired, GraphiQL and introspection dev-only, depth and cost limits on everywhere, resolver tests against **PGlite** (document 05).

---

**Next:** document 05 — delivery. ISR and tag revalidation, auth and the `admin123` rule, PGlite, the migration workflow, and the milestones end to end.
