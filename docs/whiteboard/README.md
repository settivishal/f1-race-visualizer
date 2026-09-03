# Whiteboard — the system design, taught

Six documents and eight diagrams. Written to be *learned from*, where
[`../system-design.md`](../system-design.md) is written to be *correct*. Nothing here
contradicts it; where they overlap, `system-design.md` is authoritative.

Read `00` first — the named principles and patterns the design embodies — then `01`
through `05` in order.

| # | Document | Covers |
|---|---|---|
| 00 | [Principles & Patterns](00-principles-and-patterns.md) | SOLID, GoF patterns that genuinely appear, patterns deliberately *not* used, architectural and general principles |
| 01 | [System Overview & Architecture](01-system-overview.md) | The problem, the five constraints, the v1 post-mortem, the five core decisions, the four request paths |
| 02 | [Data Model](02-data-model.md) | Table by table, column by column. Closes with the 13 invariants the schema makes impossible |
| 03 | [Ingest Pipeline](03-ingest-pipeline.md) | Functional core / imperative shell, rate limits, the `/position` ↔ `/laps` join, transactions, idempotency |
| 04 | [API Layer](04-api-layer.md) | Why GraphQL is here, one schema two transports, N+1 and DataLoader, hardening, codegen |
| 05 | [Delivery](05-delivery.md) | ISR and tag revalidation, auth, PGlite, the migration workflow, quality gates, milestones |

## Diagrams

`.mmd` files are Mermaid — GitHub renders them if pasted into a fenced ` ```mermaid ` block,
and [mermaid.live](https://mermaid.live) opens them directly. `.svg` files open in any browser.

| # | File | Subject |
|---|---|---|
| D1 | [d1-system-architecture.mmd](diagrams/d1-system-architecture.mmd) | External → ingest → Postgres → GraphQL → server/client |
| D2 | [d2-request-paths.mmd](diagrams/d2-request-paths.mmd) | The four request paths, cache hit and miss shown separately |
| D3 | [d3-ingest-internals.mmd](diagrams/d3-ingest-internals.mmd) | Fetch, validate, join, transform, upsert in a tx, revalidate |
| D4 | [d4-er-diagram.svg](diagrams/d4-er-diagram.svg) | Tables, keys, cardinality, the constraints that carry meaning |
| D5 | [d5-layers.svg](diagrams/d5-layers.svg) | Layers with dependency arrows — DIP concretely |
| D6 | [d6-pattern-map.mmd](diagrams/d6-pattern-map.mmd) | Pattern map; doubles as the table of contents |
| D7 | [d7-milestones.mmd](diagrams/d7-milestones.mmd) | M0 → M4 with acceptance criteria |
| D8 | [d8-n-plus-one.svg](diagrams/d8-n-plus-one.svg) | N+1 vs DataLoader — the query-count picture |

**D4** is the one worth keeping open while writing `src/db/schema.ts`.
