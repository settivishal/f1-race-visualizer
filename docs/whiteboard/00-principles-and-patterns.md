# 00 · Principles & Patterns

*The vocabulary, before the system. Read this first — the five documents that follow are
this document applied to one specific problem.*

Every entry has the same four parts:

1. **What it says** — the general principle, stated plainly.
2. **Why it matters** — what it is actually protecting you from.
3. **Here** — the exact place it shows up in the F1 v2 design.
4. **v1** — where the first attempt broke it, and what that cost.

The fourth part is the one that makes this stick. v1 was a real system that really shipped,
and its post-mortem reads like a catalogue of these principles being violated one at a time.
Abstract rules are forgettable. A rule attached to a specific 3am problem is not.

---

## Part 1 — SOLID

Five principles about where to put boundaries in code. They were written for object-oriented
class design, but every one of them survives translation to modules, functions, and services —
which is how they are used here.

### S · Single Responsibility Principle

**What it says.** A module should have one reason to change.

**Why it matters.** "Reason to change" is the key phrase — not "does one thing", which is too
vague to be useful. If the OpenF1 response shape changes *and* the database schema changes
*and* the retry policy changes, and all three force you to edit the same file, that file has
three responsibilities and will be edited three times as often, each time risking the other
two.

**Here.** The ingest pipeline is split by reason-to-change:

| Module | Its one reason to change |
|---|---|
| `lib/ingest/openf1.ts` | The upstream API changed |
| `lib/ingest/transform.ts` | Our interpretation of the data changed |
| `lib/ingest/run.ts` | Our persistence or orchestration changed |
| `lib/ingest/images.ts` | Our asset storage changed |

A new OpenF1 field touches one file. A new database column touches a different one. Neither
touches the other.

**v1.** `race-import.service.ts` was roughly 1,100 lines and held all four responsibilities.
It was also completely untested — and those two facts are the same fact. You cannot unit-test
a function that fetches, interprets, and writes in one breath, because you cannot run it
without a network and a database. The size was not the problem; the size was the symptom.

### O · Open/Closed Principle

**What it says.** Open for extension, closed for modification. Adding a case should not mean
editing the code that handles the existing cases.

**Why it matters.** In practice this is mostly about making the extension point *visible*. The
question to ask is: when a new variant arrives, where does it get added, and does the compiler
tell me every place I need to touch?

**Here.** `race_events.type` is a Postgres enum with nine values. Adding a tenth is a schema
change plus a migration — a deliberate, reviewed, atomic act. TypeScript then fails to compile
every `switch` that does not handle it. The extension point is explicit and the compiler is
the enforcement.

**v1.** `race_events.type` was a free `String`. Adding an event type meant writing a new
string somewhere, and a typo — `"OVERTAKE "` with a trailing space, `"Overtake"` with the
wrong case — rendered *nothing at all*, silently. No error, no log, just a missing marker on
the replay. The system was open for extension in the worst possible way: open to anything,
including nonsense.

### L · Liskov Substitution Principle

**What it says.** If something claims to be a `T`, every place that accepts a `T` must work
with it. Subtypes may not weaken the guarantees their parent made.

**Why it matters.** This is the principle behind "don't lie about your types". A subtype that
throws on a method its parent supports, or returns null where the parent never did, breaks
every caller that trusted the declared type.

**Here.** `RaceType` is `GRAND_PRIX | SPRINT`, and the design's rule is that both are fully
substitutable: a sprint is a race with laps, positions, events, and results, everywhere a
grand prix is. No resolver, no component, and no query branches on which one it is. That is
what makes it safe for `Meeting.races` to return a plain list.

The temptation is to sneak in an exception — "sprints have no pit data, so return null" — and
the moment you do, every consumer needs a null check and the abstraction has stopped paying
for itself. The design instead keeps sprints structurally identical and lets the *data* be
what differs.

**v1.** Sprints could not be represented at all. `races` carried `unique(seasonId, round)`
alongside `unique(openf1SessionKey)`, and a sprint weekend has one round with two scored
sessions. The two constraints could not both hold. This is the deeper lesson: LSP violations
often start in the data model, not the code. If the schema cannot express two things as the
same kind of thing, no amount of careful coding downstream will make them substitutable.

### I · Interface Segregation Principle

**What it says.** No client should be forced to depend on things it does not use.

**Why it matters.** Over-broad interfaces couple you to changes you do not care about. In a
GraphQL system this principle is not advice — it is the entire premise of the query language.

**Here.** Each component declares a fragment naming exactly the fields it renders. The replay
player asks for `RaceReplayFragment`. The race card asks for name, country, date, and hero
image, and never receives 1,200 position rows. The timing tower asks for one lap's slice. Each
consumer's dependency is precisely its need, and codegen turns each fragment into a type — so
a component physically cannot read a field it did not ask for.

**v1.** REST endpoints returned whatever the controller decided, so the race list page
downloaded full race objects to render a card. The client then discarded most of it. Every
consumer depended on every field, which meant any response change was a potential breakage
anywhere.

### D · Dependency Inversion Principle

**What it says.** High-level policy should not depend on low-level detail. Both should depend
on an abstraction.

**Why it matters.** It is the principle that makes testing possible without mocking the
universe, and the one most often misunderstood as "add an interface for everything" — which is
the opposite of the point. You invert a dependency when you have a *reason*: a second
implementation, or a test that needs a different one.

**Here.** Two real inversions, both earning their keep:

- **Resolvers depend on the Pothos context, not on a Neon client.** A resolver receives
  `ctx.db` and `ctx.loaders`. It has no idea whether that is Neon over WebSocket or PGlite in
  a WASM sandbox — which is exactly why the same resolver runs in production and in a Vitest
  suite with no network. The test strategy is a *consequence* of this inversion, not an
  addition to it.
- **`transform.ts` depends on plain data, not on a fetch client.** It takes parsed payloads and
  returns rows. There is nothing to inject because there is nothing to inject *into*: no I/O
  at all. This is inversion taken to its conclusion, and it is why the hardest logic in the
  system is also the easiest to test.

**v1.** The import service constructed its own HTTP client and its own Prisma client inside
its own methods. There was no seam. Testing it would have required intercepting the network
and standing up a database, which is precisely why it was never tested.

---

## Part 2 — Gang of Four patterns that genuinely appear

Naming a pattern is only useful when it buys shared vocabulary for something already there.
These six are in this design because the design needed them, not the reverse.

### Strategy — `transform.ts`

A family of algorithms, interchangeable behind one signature.

`transform` is a pure function: raw payloads in, rows out. Because it holds no state and
touches no I/O, an alternative implementation is a drop-in — which matters concretely, because
the `/position` join is the one piece of logic most likely to need a second version when a
weird race breaks it. Fixture tests then run both against the same recorded input and diff the
output. That is Strategy doing real work rather than decorating a single implementation.

### Adapter — `lib/ingest/openf1.ts`

Translating a foreign interface into the one your system wants.

OpenF1 returns its own shapes, with its own field names and its own idea of time. This module
is the only place in the entire codebase that knows what those shapes look like. Everything
downstream sees validated, renamed, domain-shaped data. When OpenF1 changes a field name, one
file changes.

This is also where the throttle lives — which is an Adapter decision, not an incidental one.
The rate limit is a property of the foreign interface, so it belongs in the thing that adapts
it, and every caller inherits correct behaviour without knowing the limit exists.

### Facade — `graphql/execute.ts`

One simple entry point in front of a subsystem.

A server component calls `execute(document, variables)` and gets typed data. Behind it sits
schema construction, context creation, DataLoader instantiation, and `graphql.execute()`. The
component knows none of that — and crucially, it does not know whether the data arrived over
HTTP or in-process. That ignorance is what lets one schema serve two transports.

### Template Method — the ingest run

A fixed skeleton with variable steps.

Every ingest, whether from cron or from `backfill.ts`, follows the same sequence: record a
`RUNNING` row, fetch, validate, transform, upsert inside one transaction, record `SUCCESS`
with a row count or `FAILED` with the error, revalidate cache tags. The skeleton is fixed
because the *invariants* live in it — every attempt is recorded, every write is atomic, the
cache is only ever invalidated after a commit. What varies is which race and which endpoints.

### Identity Map + Batching — DataLoader

Two classic patterns in one small library, and the reason it is worth understanding rather
than just installing.

- **Identity Map:** within one request, an entity is loaded once and reused. Ask for driver
  `abc` forty times, get one row and thirty-nine cache hits.
- **Batching:** requests made within the same tick are collected and issued as a single
  `WHERE id = ANY($1)`.

Together they turn the N+1 problem from a catastrophe into a non-event. This is developed
properly in document 04 — it is the single most important mechanical idea in the API layer.

### Builder — Pothos

Constructing a complex object step by step.

`builder.objectType(...)`, `builder.queryField(...)` — each call contributes a piece, and the
finished schema is assembled at the end. The payoff here is type inference: because the schema
is *built* from Drizzle models in TypeScript rather than parsed from a string, a column that
does not exist is a compile error rather than a runtime null.

---

## Part 3 — Patterns deliberately **not** used

Usually the more interesting list. Each of these is a well-known pattern that a system this
shape is "supposed" to have, and each was rejected for a stated reason. A pattern you can
justify *not* using is a pattern you actually understand.

### No Repository layer over Drizzle

**The pattern:** wrap data access in `RaceRepository`, `DriverRepository`, so the domain never
touches the ORM.

**Why not:** Repository exists to abstract over a persistence mechanism you might swap, and to
hide a query language that leaks. Drizzle is already a thin, typed, composable query layer —
wrapping it produces a second API that does the same thing with fewer features, and every new
query needs a new method on the wrapper before it can be written. The database is Postgres and
will remain Postgres; the swap the pattern insures against is not going to happen.

**What replaces it:** resolvers query Drizzle directly, and the *loaders* are the seam that
matters — they are where batching and caching live, which is the part that genuinely needs a
home.

**When to revisit:** if the same non-trivial query appears in three resolvers, it becomes a
named function. That is not a Repository; it is just naming a thing.

### No Singleton for the database pool

**The pattern:** a class with a private constructor and `getInstance()`.

**Why not:** a module-level `const pool = new Pool(...)` in `db/index.ts` is already a
singleton — ES module semantics guarantee one instance per process. The class adds ceremony
around a language feature that already does the job.

### No Observer / event bus for cache invalidation

**The pattern:** ingest emits `RaceIngested`, subscribers react, revalidation happens
somewhere else.

**Why not:** there is exactly one subscriber and it will always run in the same process, one
line after the commit. An event bus here would take a direct causal link — *this write
invalidates that cache* — and hide it behind indirection, making the most important ordering
constraint in the system (revalidate only after commit succeeds) invisible at the call site.

**When to revisit:** a second, genuinely independent reaction to ingest — a notification, a
webhook, a search index update — is the point at which the indirection starts paying.

### No abstract "DataSource" interface over OpenF1

**The pattern:** an interface with `OpenF1DataSource` behind it, so another provider can be
plugged in.

**Why not:** an interface with one implementation is not an abstraction, it is a second name
for the same thing. The design just removed its only other data source (Jolpica) on the
grounds that it had no job left. Building a plug point for the provider you deliberately
deleted is speculative generality of the purest kind.

---

## Part 4 — Architectural patterns

### Functional core, imperative shell

**What it says.** Push all decision-making into pure functions. Push all I/O to the edges. The
core computes; the shell performs.

**Why it matters.** This is the single highest-leverage structural idea in the whole design,
because it decides what is testable. Pure functions need no database, no network, no fixtures
beyond their inputs, and no mocks — they are just functions. I/O needs all of that, so you
want as little of it as possible and you want it *dumb*.

**Here.**

```
SHELL   openf1.ts     fetch, retry, throttle          — I/O, minimal logic
  ↓
CORE    transform.ts  the /position ↔ /laps join,     — pure, no I/O,
                      lap numbering, retirements,        exhaustively tested
                      event derivation
  ↓
SHELL   run.ts        transaction, upsert, record     — I/O, minimal logic
```

The hard part — the join that decides lap numbering, who retired, and what a red flag does to
the running order — sits in the middle with no dependencies. It is tested against recorded
fixtures from the races that actually broke.

**v1.** No such separation existed, so the hard logic was unreachable by tests, and its bugs
were found by looking at a wrong-looking replay rather than by a failing assertion.

### Layered architecture, and where the dependency arrows point

The system is layered — presentation, API, domain, persistence — with one rule: **arrows
point inward and never back out.** `transform.ts` knows nothing about GraphQL. The schema knows
nothing about React. A cycle anywhere in that graph is a design bug.

It is *not* hexagonal architecture, and it is worth saying so rather than claiming the more
impressive name. Hexagonal means every external dependency sits behind a port with adapters
on either side, so the domain can be driven by anything. That buys real freedom, and it costs
an interface and an implementation per boundary. With one developer, one database, one data
source, and one UI, those ports would have exactly one adapter each — which is the definition
of an abstraction that has not earned its place.

The single genuine port is the GraphQL schema, and that one exists because it *already has
two adapters*: in-process execution for server components, HTTP for clients.

### CQRS, informally

Reads and writes take different paths through this system, and it is worth noticing that this
is a real architectural choice:

- **Writes** go through the ingest pipeline: batch, transactional, Drizzle-direct, no GraphQL.
- **Reads** go through GraphQL: DataLoader-batched, cached by ISR.

Wrapping a 1,200-row import in GraphQL mutations would be ceremony — mutations are shaped for
user-initiated single-entity changes, not bulk loads. This is the useful half of CQRS
(different paths for different access patterns) without the expensive half (separate models,
separate stores, eventual consistency).

---

## Part 5 — The general principles doing the most work

### Single source of truth

If a fact is stored twice, the two copies will disagree, and the bug will surface far from the
cause. Almost every v2 decision is an instance of this principle:

| Fact | One home | The rejected second home |
|---|---|---|
| The database schema | `schema.ts` → migrations | `drizzle-kit pull` writing back |
| Which driver drove a car | `assignmentId` | a parallel `driverId` column |
| Championship points | `race_results` | a `standings_snapshots` blob |
| A page's URL | stored `slug` | derived from a mutable name |
| Whether ingest is enabled | `app_config` | a redeployed `vercel.json` |

**v1** got the first three wrong. `prisma db pull` overwrote the hand-authored schema. Position
rows carried both `driverId` and `driverAssignmentId`. Standings came from upstream while race
data came from ours, so the two could disagree with nothing to detect it.

### Idempotency

**What it says.** Running an operation twice produces the same state as running it once.

**Why it matters.** Anything scheduled, retried, or manually re-triggered will run twice
eventually. If the second run corrupts the first, every failure becomes a data-repair job.

**Here.** Idempotency is a *schema* property, not application logic. The unique constraint
`(race_id, lap, assignment_id)` means a re-import upserts rather than duplicates. There is no
"have I already imported this?" check to get wrong, because the database cannot be persuaded
to hold the row twice. The verification step is literally: run the backfill, run it again, and
confirm row counts are identical.

### YAGNI, and where it was overruled

**What it says.** Don't build for a requirement you don't have.

**Here it removed:** the separate API service, a Repository layer, a DataSource interface, an
event bus, Sentry, public accounts, custom domain, shadcn/ui.

**Here it was consciously overruled once:** GraphQL. Server components could query Drizzle
directly, and this design says so out loud rather than inventing a justification. GraphQL is
here as a learning goal — and it was made honest by being *the* data layer rather than a
veneer over three queries, so that the parts worth learning (schema design, DataLoader,
pagination, fragments, codegen) are unavoidable rather than optional.

That is the right way to break YAGNI: name the real reason, and make the thing carry enough
weight that it cannot be faked.

### Fail loudly, and leave a trace

Every ingest attempt writes an `ingest_runs` row — `RUNNING` on start, then `SUCCESS` with a
count or `FAILED` with the error text. No exception is swallowed.

This is also why the design skips Sentry without skipping observability. The failure mode that
actually matters here is a silent cron failure, and that is visible as a stale `ingest_runs`
row — a check that needs no third-party service and no monthly cost.

### Make the illegal state unrepresentable

The strongest form of correctness is the kind the type system or the database refuses to let
you express.

- `app_config` has a `CHECK (id = 1)`. There cannot be two config rows.
- `race_positions` is unique on `(race_id, lap, position)`. Two cars cannot hold P3 on lap 12.
- `race_results` is keyed on `(race_id, assignment_id)`. A driver cannot be classified twice.
- Event types are an enum. An unknown event type is a migration, not a silent no-op.

Each of these is a class of bug that cannot be written, as opposed to a class of bug that gets
caught in review if someone is paying attention.

---

## How to use this document

Read the five that follow with these names in hand. When a design decision seems arbitrary,
find the principle it is serving — it will be one of the ones above, and the reason will
usually be a specific v1 failure rather than a matter of taste.

| Next | Subject |
|---|---|
| **01** | System overview, constraints, the v1 post-mortem, request paths |
| **02** | Data model, entity by entity, and the invariants it enforces |
| **03** | Ingest pipeline, and the `/position` ↔ `/laps` join in detail |
| **04** | GraphQL layer, N+1, DataLoader, hardening |
| **05** | Delivery — caching, auth, testing, CI/CD, milestones |
