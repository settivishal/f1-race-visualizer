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

Walk-forward over 2025–2026 (40 races, through Kuala Lumpur 2026). Each race is predicted by a model trained only on the races before it. No weekend is ever on both sides of the split.

Trained on 2018–2026 (189 races):

| | Brier | favourite won |
|---|---|---|
| lgbm-v1 | 0.0250 | 27/40 |
| quali-rate table | 0.0253 | 27/40 |
| pole wins (0/1) | 0.0313 | 27/40 |
| quali + driver and constructor form, no weighting | 0.0244 | 27/40 |
| all features | 0.0265 | 25/40 |

Half-lives of 365, 730 and 1095 days tie; no weighting (0.0253) and 180 (0.0254) are worse. Adding form helps a little, but the per-race difference from v1 (−0.012 ± 0.036) is well inside the noise, and the circuit adds nothing. So v1 stays quali only. Recheck form after another dozen races.

Calibration is fine within noise (`out/calibration.png`). Predictions of 0.2 or less: 13 winners from 779 drivers, 1.7% against 1.7% predicted. Favourites at 0.4–0.8: 27 of 40 won, against about 60% predicted, so slightly under-confident.

## Known data quirks

- 2018–2022 have no sprint results, so `sprint_finish_position` is blank there. On the six 2021–22 sprint weekends, the GP started from the sprint result, not from qualifying.
- Classified retirements count as finishes. `round` is our internal numbering, which counts cancelled rounds; don't use it as a feature.
