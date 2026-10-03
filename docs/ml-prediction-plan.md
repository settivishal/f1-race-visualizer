# Pre-race win prediction — plan

## Context

`docs/ml-prediction-plan.md` (untracked) proposes a win-probability model that is published before each GP. It was written without knowledge of the repo, and several of its premises are wrong:

- **Phase 0 already exists.** The Jolpica client is `src/lib/ingest/ergast.ts` and the archive path is `scripts/backfill-archive.ts` plus `.github/workflows/backfill-archive.yml`. Circuits, `races.data_tier` and the Ergast ids have been in place since M6. What is missing is data: 2018–2022 were never imported (on hold until now).
- **The main input is empty.** `race_results.grid_position` is null for every 2023+ row (`transform.ts:311`, because OpenF1 has no grid), and qualifying is stored nowhere.
- **Leakage trap.** Ergast only publishes the post-penalty grid together with the race results, so it cannot be known before the race.
- The doc also has Python writing to Neon (local `.env` is production), a "Vercel Cron" step for a Python job, and an unverified third-party upload (quantifai).
- It reverses the 2026-09-07 decisions.md entry that said "Armchair Strategist stays deferred", so it needs a decision entry before any code.

Decisions made (Vishal, 2026-09-24):
- Lift the 2018–2022 hold and fill the grid for 2023+.
- Publish **after qualifying**, with **qualifying position** as the input on both the train and serve sides. The grid is kept for analysis only.
- Features go to a **CSV built by a TS script**, not a Drizzle table.
- Drop quantifai. The baseline check moves into the Phase 4 eval.
- Python → `predictions.csv` → TS import script. Python never touches the DB.
- **Vishal hand-writes `ml/`**, especially splitting and evaluation. Claude writes everything else.

## Gating

- The Neon transfer allowance is exhausted until **2026-10-01**. The PR #120 runbook (retire `dev`, #121, #122) goes first. After that the flow is `feature/*` → `main`.
- Before 10-01, only work that needs no DB: decision entry, Ergast qualifying client and transform with fixtures, the feature builder's pure functions with unit tests.
- Every write says which DB it hits. Use the dev override first (local `.env` points at production).

## Steps

### 0. Decision entry
Add a `docs/decisions.md` entry, dated 2026-09-24. It covers: prediction feature adopted (machine half of the Strategist), the 2018–2022 hold lifted, quali-not-grid as the model input, CSV feature store, the CSV hand-off to the import, and Ergast now being read on the OpenF1 import path for grid (a partial amendment of "cron keeps exactly one upstream"). **Give the upstream amendment its own paragraph, with its reasoning.** Reading Ergast on the OpenF1 import path relaxes a rule from the design doc, so it must be easy to find, not buried in a list. Cover: why (grid is the only source), what it costs (a second failure mode on the weekend path), and what contains it (it's best-effort, a null on miss, and never fails the import).
**Replace** `docs/ml-prediction-plan.md` with this plan. Don't keep the original alongside it with a revision header.

### 1. Data (Claude)
- **2018–2022 backfill.** Run the existing `backfill-archive.yml` once per season: dev first, then prod, about 35 min each. Check each season's derived standings against the published championship (existing practice).
- **Grid fill for OpenF1 races.** Generalise `repairZeroPoints` in `src/lib/ingest/run.ts` into one Ergast read per GP. It fills `gridPosition` for every row and repairs zero points as it does now. Match on **date** and key by car number, the same pattern the points repair already uses. If Ergast doesn't have the race yet, warn and leave the row null. `sqlCoalesce('grid_position')` (`run.ts:473`) already stops a later OpenF1 re-import from nulling it. Then re-import 2023–2026 through `scripts/backfill.ts`.
- **Qualifying.** Add `fetchSeasonQualifying(year)` to `ergast.ts` (`/{year}/qualifying`, paged like `fetchSeasonResults`, with a zod schema and a fixture test). It is **not stored**. Only the feature builder reads it (YAGNI: nothing on the site shows qualifying).

### 2. Feature export (Claude)
`scripts/build-features.ts --from 2018 --to 2026 [--upcoming <slug>]` writes `ml/data/features.csv` (gitignored). The rules below come from the original doc's Phase 2 and are all kept:
- One row per driver per **GRAND_PRIX** race. Sprints only feed `sprint_finish_position` (join through `meetings`). The label is `final_position = 1` from `race_results`, the official classification. `classified` = `final_position IS NOT NULL`.
- Circuit key is `meetings.circuit_id`, never the name. First check the Sepang-held "Bahrain GP" meeting points at the Sepang circuit. It's an admin-edited round and `admin_edited` lives on `races`, not `meetings`.
- The car is the assignment's team, mapped through a hardcoded **lineage map** keyed by `ergast_constructor_id` (toro_rosso→alphatauri→rb, force_india→racing_point→aston_martin, sauber/alfa→audi). **No name fallback.** If any team in range has a null `ergast_constructor_id` or an id missing from the map, the builder exits non-zero and names the team. A new team in 2027 then fails the run instead of quietly starting with no form history.
- **Grid never reaches the model.** Grid comes from the same Ergast read that can miss, so the builder doesn't emit it as a model column. If it is exported at all, it goes in a separate `analysis_*` column that the ml/ README says to drop. A unit test asserts the model columns contain no grid.
- **Upcoming race with no qualifying:** if `fetchSeasonQualifying` has no rows for the `--upcoming` round, or fewer rows than last race's field, exit non-zero and write nothing. There is no fallback to a stale entry list. The Saturday run is simply retried later.
- Driver form and constructor form are separate rolling means over normalised finish (`pos / field_size`), using prior races only. Missing history is empty (NaN), never 0. `field_size` is the count of entrants in that race. Nothing hardcodes 20.
- Entrant list = `race_results` rows for past races. For the upcoming race it is the qualifying list.
- The builder's pure functions (rolling form, lineage, normalisation) get one vitest file. It must include a "no future leakage" assert: form for race N only uses races before N.

### 3. Model (Vishal, `ml/`)
Own `pyproject.toml` (uv), outside pnpm, not imported by the app. LightGBM binary on `finished_p1`. Temporal split, whole weekends held out. Brier score and a calibration plot. Baselines are the pole-sitter (the quali P1 here) and last race's winner, and the first run doubles as the old Phase 3 check. Probabilities are normalised to sum to 1 per race. Output is `ml/out/predictions.csv` with `race_slug, driver_code, win_probability, model_version`. The 2026 regulation reset needs an honest story: recency weighting or a low-confidence flag. That's Vishal's modelling call, and the UI shows whichever he picks.

### 4. Serve (Claude)
- Migration: `race_predictions(race_id fk, driver_id fk, win_probability real, model_version text, generated_at timestamptz)`, PK `(race_id, driver_id, model_version)`. Migrate dev, then prod, by hand (the post-#120 flow).
- `scripts/import-predictions.ts`: zod-parse the CSV and resolve slug and code. It refuses to write if a race's probabilities don't sum to 1 ± 1e-6, or if a driver isn't on the entry list. It upserts, then revalidates the race page's cache tag the same way `/admin/settings` does (not a raw DB write).
- GraphQL: `Race.predictions(modelVersion?)` in `src/graphql/schema/race.ts`, with a DataLoader in `src/graphql/loaders.ts`, following existing convention. Then `pnpm gql:generate`.
- The Python job runs manually on Saturday night at first. A GitHub Action comes later, never Vercel Cron.

### 5. UI (Claude)
The pre-race panel on the race page: driver, team colour, probability sorted descending, `model_version` and generated date, and the low-confidence note for early 2026. No F1 marks. It must stay compatible with #122's prerendered race page. Predictions arrive by revalidation, not per request.

## Files
- `src/lib/ingest/run.ts`, `src/lib/ingest/ergast.ts` (+ tests, fixture via `scripts/capture-archive-fixture.ts`)
- new `scripts/build-features.ts`, `scripts/import-predictions.ts`
- `src/db/schema.ts` + a new migration
- `src/graphql/schema/race.ts`, `src/graphql/loaders.ts`, the race page component
- `docs/decisions.md`, `.gitignore` (`ml/data`, `ml/out`)

## Verification
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm gql:check`.
- Grid fill: after re-importing 2023, spot-check one grid-penalty race in `race_results` against the published grid. Re-run the import and confirm the grid survives.
- Features: hand-check three races (a sprint weekend, the 2026 Lawson substitution, a grid-penalty race), plus the Sepang round's circuit id.
- Import: feed a CSV that sums to 1.4 and confirm it is refused.
- Builder: run it with a team whose ergast id is removed and confirm a non-zero exit. Run `--upcoming` on a round with no qualifying yet and confirm a non-zero exit with no CSV written.
- The race page shows the panel, and the network tab shows only the app's own GraphQL call. `next build` route table still lists race routes as prerendered.
