# ml/: pre-race win prediction

Python model, kept separate from the app. It reads `data/features.csv` and writes `out/predictions.csv`. It never touches the database.

## Run

After qualifying, from the repo root:

```
pnpm tsx --env-file=.env.prod scripts/build-features.ts --upcoming <race-slug>
cd ml && uv run python train.py && cd ..
pnpm tsx --env-file=.env.prod scripts/import-predictions.ts
```

`train.py` is split into `# %%` cells for the Zed REPL. Run as a script, it prints the evaluation and then writes the predictions.

## Model: `lgbm-v1`

- LightGBM binary classifier on `finished_p1`, with probabilities normalised to sum to 1 per race.
- **One feature: `quali_position`**, with a monotone constraint (a worse qualifying position can't raise a driver's chance).
- A blank `quali_position` (no time set) is filled with `field_size`, meaning the back of the grid. Left as NaN, LightGBM once made such a driver the favourite.
- Recency weighting: a race 365 days older counts half as much (`HALF_LIFE`).
- `analysis_grid_position` is never used. The grid is published together with the race result, so it would leak.

## Evaluation

Walk-forward over 2025–2026 (39 races). Each race is predicted by a model trained only on the races before it. No weekend is ever on both sides of the split.

| | Brier | favourite won |
|---|---|---|
| lgbm-v1 | 0.0254 | 26/39 |
| quali-rate table | 0.0251 | 26/39 |
| pole wins (0/1) | 0.0321 | 26/39 |
| all features | 0.0280 | 22/39 |

On 2023–2026 data (85 races), adding driver form, constructor form, the sprint result, the circuit or the team made the model worse, so v1 is quali only. Calibration is fine within noise (`out/calibration.png`).

## Known data quirks

- 2018–2022 have no sprint results, so `sprint_finish_position` is blank there. On the six 2021–22 sprint weekends, the GP started from the sprint result, not from qualifying.
- `analysis_grid_position` is blank for 2023 onward.

## To do after the 2018–2022 backfill

Rebuild `features.csv` and rerun from the top. Recheck the half-life sweep (on the current data, no weighting scores 0.0251 against 0.0254 at 365) and the feature subsets. If no weighting still wins, set `HALF_LIFE = None` and flag early-2026 predictions as low confidence instead.