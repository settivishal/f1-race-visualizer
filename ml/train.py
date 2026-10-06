# %%
from lightgbm import LGBMClassifier
import pandas as pd
from sklearn.metrics import brier_score_loss
import matplotlib.pyplot as plt
from sklearn.calibration import calibration_curve
import os

# %%
FEATURES = ["quali_position"]

# -1: a higher value can only lower the win chance. 0: no constraint.
MONO = {"quali_position": -1, "field_size": 0, "driver_form": -1,
        "constructor_form": -1, "sprint_finish_position": -1}

# A race this many days older than the one being predicted counts half as much.
HALF_LIFE = 365

df = pd.read_csv("data/features.csv")
os.makedirs("out", exist_ok=True)
df["date"] = pd.to_datetime(df.date)
# No quali time means starting from the back, not "unknown". Left as NaN, LightGBM once made such a driver the favourite.
df["quali_position"] = df.quali_position.fillna(df.field_size)

upcoming = df[df.finished_p1.isna()]
df = df[df.finished_p1.notna()]

races = df.drop_duplicates("race_slug").sort_values("date")[["race_slug", "date", "season"]]

# %%
def walk_forward(features=FEATURES, start_season=2025, half_life=HALF_LIFE):
    out = []
    for slug, date in races.loc[races.season >= start_season, ["race_slug", "date"]].values:
        train = df[df.date < date]
        test = df[df.race_slug == slug].copy()

        w = None
        if half_life:
            age = (date - train.date).dt.days
            w = 0.5 ** (age / half_life)

        model = LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=7, verbose=-1,
                               monotone_constraints=[MONO[f] for f in features])
        model.fit(train[features], train.finished_p1, sample_weight=w)
        p_raw = model.predict_proba(test[features])[:, 1]
        test["p"] = p_raw / p_raw.sum()
        test["p_pole"] = (test.quali_position == 1).astype(float)
        rates = train.groupby("quali_position").finished_p1.mean()
        q = test.quali_position.map(rates).fillna(0)
        test["p_quali"] = q / q.sum()
        out.append(test)
    return pd.concat(out)

def score(preds, name="p"):
    n = preds.race_slug.nunique()
    brier = brier_score_loss(preds.finished_p1, preds[name])
    hits = preds.loc[preds.groupby("race_slug")[name].idxmax(), "finished_p1"].sum()
    return f"brier {brier:.4f}  hit {hits}/{n}"

# %%
preds = walk_forward()
for name in ["p", "p_quali", "p_pole"]:
    print(f"{name:8}", score(preds, name))
# %%
frac_won, mean_p = calibration_curve(preds.finished_p1, preds.p, n_bins=5, strategy="uniform")


plt.plot([0, 1], [0, 1], "--", color="grey", label="perfect")
plt.plot(mean_p, frac_won, "o-", label="lgbm-v1")
plt.xlabel("predicted win probability")
plt.ylabel("actual win rate")
plt.legend()
plt.savefig("out/calibration.png", dpi=120)
# plt.show()

# %%
# Races where the model's favourite is not the pole-sitter.
top = preds.loc[preds.groupby("race_slug").p.idxmax(), ["race_slug", "driver_code", "quali_position", "p", "driver_form"]]
pole = preds.loc[preds.quali_position == 1, ["race_slug", "driver_code", "driver_form"]]
won = preds.loc[preds.finished_p1 == 1, ["race_slug", "driver_code", "quali_position"]]

cmp = (top.merge(pole, on="race_slug", suffixes=("_pick", "_pole"))
          .merge(won, on="race_slug", suffixes=("", "_won")))
cmp[cmp.driver_code_pick != cmp.driver_code_pole]

# %%
# On 2018–2026 data (189 races), 365, 730 and 1095 tie (0.0249–0.0250); None (0.0253) and 180 (0.0254) are worse.
for hl in [None, 730, 365, 180, 90]:
    print(f"half-life {hl}:", score(walk_forward(half_life=hl)))

# %%
for feats in [["quali_position"],
              ["quali_position", "constructor_form"],
              ["quali_position", "driver_form"],
              ["quali_position", "constructor_form", "driver_form"],
              ["quali_position", "field_size", "driver_form", "constructor_form", "sprint_finish_position"]]:
    print(f"{str(feats):60}", score(walk_forward(features=feats)))
# %%
preds.groupby(pd.cut(preds.p, [0, .2, .4, .6, .8, 1])).finished_p1.agg(["count", "sum", "mean"])

# %%
MODEL_VERSION = "lgbm-v1"

def predict(rows, half_life=HALF_LIFE):
    """Fit on every labelled race before these rows' date, return normalised probabilities."""
    date = rows.date.min()
    train = df[df.date < date]
    w = 0.5 ** ((date - train.date).dt.days / half_life) if half_life else None
    model = LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=7, verbose=-1,
                           monotone_constraints=[MONO[f] for f in FEATURES])
    model.fit(train[FEATURES], train.finished_p1, sample_weight=w)
    out = rows[["race_slug", "driver_code"]].copy()
    p = model.predict_proba(rows[FEATURES])[:, 1]
    out["win_probability"] = p / p.sum()
    out["model_version"] = MODEL_VERSION
    return out

if upcoming.empty:
    print("no upcoming rows; build with --upcoming <slug> first")
else:
    for slug, rows in upcoming.groupby("race_slug"):
        out = predict(rows)
        assert abs(out.win_probability.sum() - 1) < 1e-6
        out.to_csv("out/predictions.csv", index=False)
        print(out.sort_values("win_probability", ascending=False).head(5))
