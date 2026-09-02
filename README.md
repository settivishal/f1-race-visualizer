# F1 Race Visualizer

A Formula 1 race replay platform. Race data is animated lap-by-lap so you can watch a
grand prix unfold as a position chart — overtakes, pit stops, safety cars, and
retirements in the order they actually happened.

**Status:** design complete, implementation starting. See [`docs/system-design.md`](docs/system-design.md).

## Why this repo exists

This is the second attempt. The first ([`f1-race-visualizer-v1`](https://github.com/settivishal/f1-race-visualizer-v1),
archived) worked, but it was built feature-first across seven phases with no system
design. Auth ended up rewritten three times, the database schema drifted out of sync
with its migrations, and the frontend and backend were deployed as separate services
for a single-developer project that never needed the split.

v2 decides the architecture first and writes it down. Every choice and its reasoning
lives in [`docs/decisions.md`](docs/decisions.md).

v1 is not discarded — it is the reference implementation. The replay engine, circuit
geometry, and OpenF1 import logic are ported from it rather than rewritten.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript, Tailwind |
| API | GraphQL — Yoga + Pothos, code-first |
| Client data | urql + graphql-codegen |
| Database | Neon Postgres + Drizzle ORM |
| Auth | Auth.js credentials, single admin account |
| Data source | OpenF1 + Ergast, ingested on a schedule into our own database |
| Hosting | Vercel (app + cron), Vercel Blob (images) |

One deployable. No separate API service. No external API is ever called during a page
request — a scheduled job writes everything to Postgres first.

## Architecture

```text
OpenF1 · Ergast · Wikipedia          (touched only by the ingest job)
            │
            ▼
     lib/ingest  ──────►  Neon Postgres  ◄────── Drizzle
                                 ▲
                          GraphQL schema (Pothos)
                                 ▲
              ┌──────────────────┴──────────────────┐
      server components                    client components
      (in-process execute)                 (POST /api/graphql)
```

## Documentation

- [`docs/system-design.md`](docs/system-design.md) — full design: data model, GraphQL layer, ingest pipeline, milestones
- [`docs/decisions.md`](docs/decisions.md) — decision log with reasoning

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Repo, Neon, Drizzle schema, first migration, Vercel wired |
| M1 | Ingest pipeline; full 2025 season backfilled, idempotent |
| M1.5 | GraphQL layer — schema, resolvers, DataLoader, codegen |
| M2 | Public replay engine and race library |
| M3 | Admin panel, auth, scheduled ingest |
| M4 | Standings, SEO, polish |

Deferred: public user accounts, and "Armchair Strategist" — a prediction game where
users call the winner and the pit strategy, scored against what actually happened.

## License

MIT
