# 03 · Ingest Pipeline

> **Where you are:** 02 defined the tables. This document is about how rows get into them — the only path by which data enters this system, and the part of v1 that failed hardest.

---

## Why this is the highest-risk component

v1's `race-import.service.ts` was **~1,100 lines, untested, and the sole entry point for all data**. Every property of the site depended on it being right, and nothing checked that it was.

It was also the wrong shape to test. It fetched, parsed, computed, and wrote in one continuous flow, so exercising the computation meant standing up an HTTP mock and a database. That cost meant no tests were written, which meant a subtly wrong algorithm (Part 4) ran in production for months while appearing to work.

v2 rebuilds it as four small modules with one seam that matters: **the computation is separated from the I/O, so the computation can be tested without either.**

```
lib/ingest/openf1.ts     fetch + zod-validate raw OpenF1 responses, rate-limited
                         /sessions /meetings /drivers /laps /position
                         /pit /race_control /session_result /weather
lib/ingest/images.ts     download headshots and logos once, put() to Vercel Blob
lib/ingest/transform.ts  pure: raw payload → rows. No I/O. This is what gets tested.
lib/ingest/run.ts        orchestrate: fetch → transform → upsert in a tx → record ingest_run
```

---

## Part 1 — Functional core, imperative shell

The four modules are not an arbitrary split. They implement a specific architectural pattern.

**The functional core** is `transform.ts`. Every function in it takes plain data and returns plain data. No `fetch`, no `db`, no `Date.now()`, no randomness, no environment variables.

**The imperative shell** is `openf1.ts`, `images.ts`, and `run.ts`. They talk to the network and the database, and they contain as little decision-making as possible.

### Why this specific seam

The interesting logic in an ingest pipeline is almost entirely *interpretation*: given these raw samples, what was the running order on lap 30? That question has nothing to do with HTTP or SQL. Tangling it with them costs three things.

**Testing.** A pure function is tested by calling it:

```ts
const rows = buildLapPositions(savedLapsFixture, savedPositionFixture);
expect(rows.filter(r => r.lap === 30)).toHaveLength(18);
```

No mock server, no test database, no async, no cleanup. Sub-millisecond. That cheapness is what makes a large fixture suite realistic — and the fixture suite is the thing that would have caught v1's bug.

**Reasoning.** A pure function has one possible output for a given input. When the Brazil replay looks wrong, the question "did the transform produce this, or did the fetch, or did the write?" has an answer you can get by calling the function.

**Reproducibility.** A bug found in production is reproduced by saving the raw payload and calling the transform on it. That saved payload then becomes a permanent regression test. The bug can never come back silently.

### The rule for the shell

Anything in the shell that starts making decisions is a signal that a pure function is trying to be born. `run.ts` should read as a sequence of steps, not as a set of branches:

```ts
export async function ingestRace(sessionKey: number) {
  const run = await startIngestRun('openf1', sessionKey);        // shell
  try {
    const raw  = await fetchRaceBundle(sessionKey);              // shell
    const rows = transformRace(raw);                             // CORE — all logic
    const n    = await writeRaceInTransaction(rows);             // shell
    await finishIngestRun(run.id, 'SUCCESS', n);                 // shell
  } catch (e) {
    await finishIngestRun(run.id, 'FAILED', 0, String(e));       // shell
    throw e;
  }
}
```

Read the middle three lines. Fetch, compute, write. All of the project's domain knowledge lives in the one line that touches nothing.

---

## Part 2 — The OpenF1 client

### Which endpoint answers which question

The client wraps nine endpoints, and the mapping is deliberate. Each fact comes from the endpoint that is *authoritative* for it, not from whichever one happens to be loaded.

| Fact | Endpoint | Notes |
|---|---|---|
| Which sessions exist | `/sessions` | Identifies races and sprints |
| Weekend metadata | `/meetings` | Circuit, country, round |
| Driver list and numbers | `/drivers` | Per-session lineup |
| **Running order** | `/position` | Timestamped samples — see Part 4 |
| Lap and sector times | `/laps` | Per driver per lap |
| Pit stops | `/pit` | Becomes `PIT_STOP` events |
| Flags, safety cars | `/race_control` | Becomes race-wide events |
| Final classification | `/session_result` | Position, status, **points** |
| Weather | `/weather` | Stored verbatim as `jsonb` |

The line worth internalising is the fourth: **running order comes from `/position`.** Not from lap times. Part 4 is about why that sentence is the most important one in this document.

### Validation at the boundary

Every response is parsed with a **zod schema** before anything else touches it.

```ts
const LapSchema = z.object({
  driver_number: z.number(),
  lap_number: z.number(),
  date_start: z.string().datetime().nullable(),
  lap_duration: z.number().nullable(),
  duration_sector_1: z.number().nullable(),
  // …
});

export async function fetchLaps(sessionKey: number) {
  const res = await throttledGet('/laps', { session_key: sessionKey });
  return z.array(LapSchema).parse(res);   // throws on shape change
}
```

This is a **trust boundary**, and validation at trust boundaries is one of the few places where extra code is never over-engineering. The value is not defensiveness for its own sake — it is *where the error surfaces*. Without validation, an upstream adding a field or nulling one produces a `TypeError: Cannot read property 'x' of undefined` somewhere deep in the transform, or worse, a silent `undefined` written into a column. With it, the failure is at the fetch, names the field, and lands in `ingest_runs.error` as a readable message.

It also gives the transform a **guaranteed input shape**, which is what lets it be written without defensive checks on every access. The purity of the core is paid for by the strictness of the boundary.

### The adapter role

`openf1.ts` is the only module in the codebase that knows OpenF1's vocabulary — `session_key`, `meeting_key`, `driver_number`, `date_start`. It translates that vocabulary into ours. Everything downstream speaks in meetings, races, assignments, and laps.

This is the Adapter pattern, and it is load-bearing in a specific way: if OpenF1 changed its response shape tomorrow, or if a second source were ever added, the blast radius is one file. Nothing else in the system has ever heard the phrase `session_key`.

---

## Part 3 — Rate limits, and where the throttle lives

### The actual numbers

OpenF1's **free tier** serves historical data from **2023 onward** at **3 requests/second and 30 requests/minute**.

Its **paid tier** covers only the *live window* — from 30 minutes before a session to 30 minutes after. A Monday-morning ingest of Sunday's race never touches that window. So the free tier is not a starting point to grow out of; **it is permanently the correct tier for this design.** Worth stating explicitly, because "we'll upgrade if we hit limits" is the usual assumption and here it would buy nothing.

### Where the limits bite

They are **irrelevant for a cron run**: one race, roughly eight endpoint calls, done in seconds.

They **matter for a backfill**. A full 2025 season is about **24 meetings × ~8 endpoints ≈ 200 requests**. At 30/minute that is a floor of roughly seven minutes — fine, but only if the requests are actually paced. Fired in parallel, the same 200 requests produce a wall of 429s partway through and a half-imported season.

### The design decision: throttle in the client

The throttle lives inside `lib/ingest/openf1.ts`, wrapping every request.

```ts
// One shared limiter. Every fetch in this module goes through it.
const limiter = rateLimit({ perSecond: 3, perMinute: 30 });

async function throttledGet(path: string, params: Params) {
  return limiter.run(() => retryWithBackoff(() => http.get(path, params)));
}
```

The alternative — each caller sleeping between its own requests — is worse for a reason worth naming: **it makes correctness a thing every caller must remember.** The backfill script would sleep, the cron path would forget (it does not need to today), and the first time someone adds a third caller the limit is breached. Putting it in the client makes respecting the limit unavoidable rather than conventional.

This is the same instinct as the schema constraints in document 02. **Make the correct behaviour structural, so it cannot be omitted.**

### Failure handling

A `429` or `5xx` retries with exponential backoff. If it still fails after retries, the exception propagates, `run.ts` catches it, and the run is recorded `FAILED` in `ingest_runs` with the error text.

**Nothing is ever swallowed.** A partial import that reports success is strictly worse than a loud failure, because a loud failure gets retried tomorrow and a quiet one becomes a race page with 40 laps missing that nobody notices for a month. See the transaction discussion in Part 6 — a failed run leaves no partial rows at all.

---

## Part 4 — The `/position` ↔ `/laps` join

This is the hardest problem in the project and the most instructive bug in v1. It gets extended treatment because everything visible on the site depends on getting it right.

### What v1 did

v1 had no `/position` call. It derived running order from lap times alone:

```
for each driver:
    cumulativeTime = sum of lap_duration for laps 1..n
sort drivers by cumulativeTime ascending
that ordering is the running order at lap n
```

`buildPositionsFromLaps`. It ran for months. It produced plausible-looking replays. **It was wrong in at least four distinct ways**, and none of them announced themselves.

### Failure 1 — retirements vanish

A driver who retires on lap 30 has no lap rows after lap 30. The sort operates on whoever has rows. On lap 31 that driver is simply **absent from the field** — not shown as retired, not shown at all. The remaining cars silently shuffle up one place each.

The replay showed a car disappearing mid-race with no explanation, and the timing tower showed nineteen cars where there had been twenty. Because v1 had no `race_results` table (document 02, Part 4), there was no other record that a retirement had occurred — the absence *was* the entire representation.

### Failure 2 — safety cars and red flags reorder the field

Under a safety car every car circulates slowly, but not *identically* slowly. A car at the back of a queue loses a fraction of a second more than the leader. Cumulative-time sorting sees those fractions as position changes.

Worse, a driver who pits under a safety car takes a slow lap and drops several places in the *sum*, even when the real running order has them gaining. Red flags are more extreme still: the clock stops, cars are stationary in the pit lane for twenty minutes, and lap timing either omits the period or reports something meaningless.

The result was **overtakes that never happened**, appearing exactly at the moments — safety car periods — when a viewer is most likely to be watching closely.

### Failure 3 — pit stops read as position loss

A car that pits loses ~20 seconds on that lap. Cumulative sorting drops it several places. Sometimes that matches reality; often it does not, because the cars it "lost" to may have pitted a lap earlier and be behind on track. The algorithm cannot tell the difference, because **it has no concept of track position at all** — only of elapsed time.

### Failure 4 — the errors accumulate

Every one of these is a *cumulative sum*. An error introduced on lap 12 persists in every subsequent lap's total. The replay does not just have wrong laps; it has wrong laps that **stay** wrong, drifting further from reality as the race goes on.

### Why nobody caught it

This is the part worth sitting with. The algorithm is **defensible on paper** — total elapsed time really does determine race position, in an idealised race. It produces output for every lap. The output has the right shape: twenty drivers, positions 1–20, changing over time. A replay built on it *looks like a race*.

It fails only in exactly the situations that are hard to eyeball: retirements, safety cars, pit windows. To catch it you would need to compare against the real running order for a specific lap of a specific race — which is precisely the check that never gets written when the import code cannot be tested without a database.

**Three v2 decisions are direct responses to this one bug:**

1. `/position` as the authoritative source, rather than a derived quantity.
2. The transform being pure, so this class of logic *can* be fixture-tested.
3. The two unique constraints on `race_positions`, so structurally impossible output aborts the write.

### What `/position` actually gives you

`/position` is not per-lap rows. It is a **timestamped sample stream**:

```json
{ "driver_number": 1,  "position": 3, "date": "2025-11-09T18:14:22.418Z" }
{ "driver_number": 44, "position": 4, "date": "2025-11-09T18:14:22.911Z" }
{ "driver_number": 1,  "position": 2, "date": "2025-11-09T18:16:03.204Z" }
```

Samples arrive when a position *changes*, not on a fixed schedule. A leader who leads from lights to flag may have exactly one sample all race.

`/laps` is per-lap rows with `date_start` and `lap_duration` — that is, **when each lap began and how long it took**.

So the two are in different coordinate systems: one is keyed by time, the other by lap number. The transform's job is to convert.

### The join rule

> **For each driver-lap, take the last `/position` sample whose `date` is at or before `lap.date_start + lap_duration`.**

In other words: *what position was this driver in at the moment they crossed the line to complete this lap?* That is the definition of a lap's running order, and it is exactly what a timing screen shows.

### Worked example

Driver #1, lap 30. From `/laps`:

```
date_start   = 18:13:41.000
lap_duration = 92.4s
lap ends at    18:15:13.400
```

Relevant samples from `/position` for driver #1:

```
18:02:11  position 4
18:14:22  position 3      ← last sample at or before 18:15:13.400
18:16:03  position 2         (belongs to lap 31, not lap 30)
```

Take the sample at 18:14:22. **Lap 30, driver #1, position 3.**

Note what the rule handles for free:

- **The leader with one sample.** No sample within lap 30's window, so the rule walks back to the most recent earlier sample — position 1, still true. Sparse data is correct data.
- **The lap-31 sample.** It falls after the boundary and is correctly excluded from lap 30, even though it is only 50 seconds later.
- **A driver who retires on lap 30.** They have no lap 31 row in `/laps`, so no lap 31 driver-lap exists to join, and they produce no position row from lap 31 onward. *But* `/session_result` gives them `status = 'DNF'` and `lapsCompleted = 30`, so the retirement is recorded explicitly rather than inferred from absence. This is the failure-1 fix, and it needs both halves.
- **A safety car.** Positions do not change, so no samples arrive, so every lap under the safety car resolves to the same running order. Correct — which is exactly what the cumulative-time approach could not do.

### The edge cases that need explicit handling

The rule is simple; the situations it must survive are not. These are the fixtures to build.

**No prior sample at all.** A driver's first lap may complete before any `/position` sample for them exists. Fall back to the grid position from `/session_result`. Never silently drop the row — a missing driver on lap 1 violates nothing structurally but is wrong.

**Red flag gaps.** During a suspension there may be no lap rows for anyone. Lap numbering resumes after the restart, possibly with a gap. Document 02 deliberately does **not** constrain lap numbers to be contiguous, precisely so a red-flagged race can be stored honestly.

**Null `lap_duration`.** An in-lap, an out-lap, or a lap interrupted by a red flag may have no valid duration. The window's end cannot be computed. Fall back to the *next* lap's `date_start` as the boundary, and if that is also unavailable, carry the previous lap's position forward.

**Duplicate resulting positions.** If two drivers resolve to the same position on the same lap, that is a bug in the join, not a fact about the race. The unique constraint `race_positions (race_id, lap, position)` catches it and aborts the transaction. **Do not add code to "fix" a collision by nudging one driver** — that hides the bug. Let it fail, then write the fixture.

### Why this function is the most tested thing in the codebase

It is where lap numbering, retirements, safety cars, red flags, and pit stops all converge. Every one of them is a boundary condition on the same join. And because the function is pure, each is a three-line test against a saved fixture.

The fixture set comes from **the races that actually broke** — M1's completion criterion is a full 2025 season, which means every one of these situations arrives during the backfill rather than ambushing the replay work in M2. Each race that fails becomes a permanent regression test.

---

## Part 5 — Images: fetch once, at ingest

```
ingest driver → has headshotUrl on our blob?  → yes: done
                                              → no:  fetch Wikipedia/OpenF1 image
                                                     → put() to Vercel Blob
                                                     → store returned URL on drivers row
```

Three consequences, each one fixing something v1 got wrong.

**The check comes first, so this is idempotent.** Re-running an ingest does not re-download twenty headshots. The presence of a URL in our column is the memo.

**Pages serve our URL, so `next/image` optimization is on.** v1 hotlinked remote sources and had to disable optimization entirely, because Next cannot optimize an origin it does not control and unstable remotes broke the build's image config. Owning the bytes removes the constraint.

**A failed image fetch never fails an ingest.** The fallback is a team-colour initials badge. An image is decoration; the race data is the point, and coupling them means a Wikipedia hiccup costs a week of race data. Log it, continue, pick it up on the next run.

Team logos take the same path. Attribution — Wikipedia images are CC BY-SA — is a line on `/about`, handled in M4.

---

## Part 6 — Writing: transactions and idempotency

### One race, one transaction

```ts
await db.transaction(async (tx) => {
  await tx.insert(meetings).values(m).onConflictDoUpdate(...);
  await tx.insert(races).values(r).onConflictDoUpdate(...);
  await tx.insert(racePositions).values(positions).onConflictDoUpdate(...);
  await tx.insert(raceEvents).values(events).onConflictDoUpdate(...);
  await tx.insert(raceResults).values(results).onConflictDoUpdate(...);
});
```

A race is atomic: either the whole thing is in the database or none of it is. The failure this prevents is **a race with 40 of its 60 laps** — which renders without error, looks almost right, and is far harder to detect than a race that is simply absent.

> **A partially-imported race is worse than a missing one.** Absence is visible; corruption is not.

**This is why the database client is `drizzle-orm/neon-serverless` with a WebSocket `Pool`, not the HTTP driver.** Neon's HTTP driver cannot hold a multi-statement transaction — each statement is an independent request. The transaction requirement above is what forces the driver choice; the driver was not picked first and lived with.

### Idempotency comes from the schema, not from logic

Every write is `INSERT … ON CONFLICT DO UPDATE`, targeting a unique constraint from document 02:

| Table | Conflict target |
|---|---|
| `meetings` | `openf1_meeting_key` |
| `races` | `openf1_session_key` |
| `race_positions` | `(race_id, lap, assignment_id)` |
| `race_results` | `(race_id, assignment_id)` — the composite PK |
| `driver_team_assignments` | `(team_season_id, driver_id)` |

Re-running an import **cannot** duplicate a row, because there is no state in which a duplicate is storable.

Notice what this design does *not* contain: no "have I already imported session 9636?" lookup, no `imported_at` flag to check, no de-duplication pass. Those are the usual approach and every one of them is a thing that can be wrong — a check that races with a concurrent run, a flag set before the write completes.

The constraint approach has none of those failure modes because it is not a check at all. **Idempotency is a property of the schema, not a behaviour of the code.**

Verification step 2 is the proof: run `scripts/backfill.ts <sessionKey>` twice, and row counts must be identical after the second run, with two `SUCCESS` rows in `ingest_runs`.

### `race_events` is the exception

Events have no natural unique key — two overtakes on the same lap by the same driver are legitimately two rows. The pattern there is **delete-then-insert within the same transaction**, scoped to the race. Atomic because of the transaction, idempotent because the old set is gone before the new one lands.

---

## Part 7 — The two entry points

Both call the same `run.ts`. The difference is entirely in what surrounds it.

### `POST /api/cron/ingest` — Vercel Cron

Guarded by a `CRON_SECRET` header. Processes **one race per invocation** and returns.

The one-race limit is a **serverless timeout constraint, not a preference**. One race is ~1,200 position rows plus events plus eight upstream calls. Several races in one invocation would risk the function limit, and a function killed mid-transaction is the partial-import scenario that Part 6 exists to prevent. One race per run keeps every invocation comfortably inside the budget.

A backlog drains at one race per day, which is faster than races arrive. Anything larger goes through the backfill script.

### The handler is smart; the schedule is dumb

```
vercel.json:  { "crons": [{ "path": "/api/cron/ingest", "schedule": "0 6 * * *" }] }
                                                          daily 06:00 UTC

handler:
  cfg = SELECT * FROM app_config
  if not cfg.ingestEnabled            → 200 {skipped: "disabled"}
  if now.weekday not in cfg.runDays   → 200 {skipped: "not a run day"}
  race = next race in cfg.activeSeason with no positions
  if none                             → 200 {skipped: "up to date"}
  ingest(race)
  revalidateTag('race'); revalidateTag('standings')
                                      → 200 {ingested: race.name}
```

Three platform facts force this shape, and all three are worth knowing before designing around Vercel Cron:

1. **Schedules live in `vercel.json` and are static.** Changing one requires a redeploy.
2. **On the Hobby plan a job runs at most once per day.**
3. **The schedule is UTC, and Vercel fires at any minute inside the stated hour** — `0 6 * * *` means somewhere in 06:00–06:59.

A daily job is exactly what this design wants, so (2) and (3) cost nothing. But (1) means the schedule cannot be where cadence lives, because cadence is the thing most likely to need adjusting. So cadence moves into `app_config` — a database row, editable from the admin panel, no deploy — and the cron schedule degenerates to "wake up daily and ask".

**Note that every skip path returns 200.** "Nothing to do" is a successful outcome, not an error. Returning 500 for it would make the Vercel dashboard show failures on six days out of seven and train you to ignore it — and a monitoring signal you ignore is worse than none.

### Revalidation is the last step

```
… upsert in a tx → COMMIT → revalidateTag('race') → revalidateTag('standings')
```

Only after the transaction commits. If the ingest fails, the cache is untouched and the pages keep serving the last good data.

The inverse ordering — revalidate first, then write — would drop the cache and then fail to replace it, taking a working page offline in response to an upstream outage. Document 05 covers the ISR side.

### `scripts/backfill.ts` — local or GitHub Actions

No serverless timeout, so it handles a full season in one run: ~200 requests, paced by the client's throttle, several minutes. Run locally during M1 or from a GitHub Action for a one-off historical import.

Same `run.ts`, same transaction boundary, same idempotency. **Two entry points, one implementation** — nothing about correctness depends on which one invoked it.

### What ingest is deliberately *not*

Ingest does **not** go through GraphQL. It writes to Drizzle directly.

GraphQL exists to serve *reads by clients that need shaping*. A 1,200-row batch write from a trusted internal process is not that. Wrapping it in mutations would add a schema layer, a serialization round-trip, and per-row resolver overhead to buy nothing at all — the definition of ceremony.

The admin panel's `triggerIngest` mutation is genuinely GraphQL because it is a client-initiated action needing auth and a typed result. It calls the same `run.ts`. **The transport is GraphQL; the work is not.**

---

## Part 8 — M1's acceptance criteria, and why they are shaped that way

> **Done when:** every 2025 meeting and its sessions (grand prix + sprints) are in the DB with correct per-lap positions and final classifications; the backfill completes a full season in one run without tripping the 30 req/min ceiling; and re-running it changes no row counts.

Three clauses, three different properties: **correctness**, **rate-limit compliance**, **idempotency**.

The demand for a *full season* rather than a few sample races is deliberate. A full 2025 season contains, without anyone having to construct them:

- **sprint weekends** — two scored sessions per meeting, the case v1's schema could not represent at all;
- **red-flagged races** — lap numbering gaps, null durations;
- **DNS/DNF drivers** — the case that broke v1's position derivation;
- **mid-season driver swaps** — already handled by `driver_team_assignments`, but untested until it happens;
- **races with fewer classified finishers than starters.**

Every one of these is a boundary condition on the Part 4 join. Meeting them during M1 — when the only thing that can be wrong is the ingest — is far cheaper than meeting them in M2, when a wrong replay could be a rendering bug, a GraphQL bug, or an ingest bug and you have three places to look.

**Build the fixture set from the races that actually broke, and keep them as regression tests.** That set is the real deliverable of M1. The imported data can always be re-imported; the fixtures encode what you learned.

---

**Next:** document 04 — the GraphQL layer. Why it is here at all, one schema over two transports, and the N+1 problem developed properly against the 1,200 rows this pipeline just wrote.
