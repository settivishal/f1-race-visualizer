# %%
# Exploration for the win model: charts, feature importance, and other models
# scored on the same walk-forward as train.py. Nothing here writes predictions.
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from lightgbm import LGBMClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
import os

# %%
# Same loading as train.py.
df = pd.read_csv("data/features.csv")
os.makedirs("out", exist_ok=True)
df["date"] = pd.to_datetime(df.date)
df["quali_position"] = df.quali_position.fillna(df.field_size)
df = df[df.finished_p1.notna()]
races = df.drop_duplicates("race_slug").sort_values("date")[["race_slug", "date", "season"]]

QUALI = ["quali_position"]
FORM = ["quali_position", "driver_form", "constructor_form"]
ALL = ["quali_position", "field_size", "driver_form", "constructor_form", "sprint_finish_position"]
MONO = {"quali_position": -1, "field_size": 0, "driver_form": -1,
        "constructor_form": -1, "sprint_finish_position": -1}
HALF_LIFE = 365

# %%
# 1. Win rate by qualifying position, per era. The chart that explains the model.
df["era"] = np.where(df.season < 2023, "2018–2022", "2023–2026")
rate = df[df.quali_position <= 10].pivot_table(index="quali_position", columns="era",
                                               values="finished_p1", aggfunc="mean")
print(rate.round(3))

rate.plot.bar(figsize=(8, 4), rot=0)
plt.xlabel("qualifying position")
plt.ylabel("win rate")
plt.title("Win rate by qualifying position")
plt.tight_layout()
plt.savefig("out/win_rate_by_quali.png", dpi=120)
# plt.show()

# %%
# 2. Correlation between the features and winning. Spearman, because positions and
# form are ranks: what matters is order, not distance.
cols = ["finished_p1", "quali_position", "driver_form", "constructor_form", "sprint_finish_position"]
corr = df[cols].corr(method="spearman")
print(corr.round(2).to_string())

fig, ax = plt.subplots(figsize=(6, 5))
im = ax.imshow(corr, cmap="coolwarm", vmin=-1, vmax=1)
ax.set_xticks(range(len(cols)), cols, rotation=45, ha="right")
ax.set_yticks(range(len(cols)), cols)
for i in range(len(cols)):
    for j in range(len(cols)):
        ax.text(j, i, f"{corr.iloc[i, j]:.2f}", ha="center", va="center")
fig.colorbar(im)
ax.set_title("Spearman correlation")
fig.tight_layout()
fig.savefig("out/correlation.png", dpi=120)
# plt.show()

# %%
# 3. Feature importance (total gain) for LightGBM fitted on every labelled race.
model = LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=7, verbose=-1,
                       importance_type="gain", monotone_constraints=[MONO[f] for f in ALL])
model.fit(df[ALL], df.finished_p1)
imp = pd.Series(model.feature_importances_, index=ALL).sort_values()
print((imp / imp.sum()).round(3))

(imp / imp.sum()).plot.barh(figsize=(7, 3))
plt.xlabel("share of total gain")
plt.title("LightGBM feature importance, all features")
plt.tight_layout()
plt.savefig("out/feature_importance.png", dpi=120)
# plt.show()

# %%
# 4. Other models on the same walk-forward. Each `make` returns an unfitted model;
# every model gets the same recency weights as lgbm-v1.
def lgbm(features):
    return LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=7, verbose=-1,
                          monotone_constraints=[MONO[f] for f in features])

def logreg():
    # The imputer fills a missing form with the training median; it is fitted per race, so no leak.
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), LogisticRegression())

def forest():
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=20, random_state=0, n_jobs=-1)

MODELS = {
    "lgbm-v1 (quali)": (lambda: lgbm(QUALI), QUALI),
    "lgbm quali+form": (lambda: lgbm(FORM), FORM),
    "logreg quali": (logreg, QUALI),
    "logreg quali+form": (logreg, FORM),
    "forest quali": (forest, QUALI),
    "forest quali+form": (forest, FORM),
}

def walk_forward(start_season=2025, half_life=HALF_LIFE):
    out = []
    for slug, date in races.loc[races.season >= start_season, ["race_slug", "date"]].values:
        train = df[df.date < date]
        test = df[df.race_slug == slug].copy()
        w = 0.5 ** ((date - train.date).dt.days / half_life)
        for name, (make, features) in MODELS.items():
            model = make()
            # A pipeline takes the weight under its last step's name.
            key = "logisticregression__sample_weight" if hasattr(model, "steps") else "sample_weight"
            model.fit(train[features], train.finished_p1, **{key: w.values})
            p = model.predict_proba(test[features])[:, 1]
            test[name] = p / p.sum()
        rates = train.groupby("quali_position").finished_p1.mean()
        q = test.quali_position.map(rates).fillna(0)
        test["quali-rate table"] = q / q.sum()
        test["pole wins"] = (test.quali_position == 1).astype(float)
        out.append(test)
    return pd.concat(out)

preds = walk_forward()

# %%
# 5. One table for every model. Log loss clips at 1e-6, so a 0/1 baseline that misses pays heavily.
def report(preds, names):
    rows = []
    for name in names:
        fav = preds.loc[preds.groupby("race_slug")[name].idxmax()]
        rows.append({"model": name,
                     "brier": brier_score_loss(preds.finished_p1, preds[name]),
                     "log loss": log_loss(preds.finished_p1, preds[name].clip(1e-6, 1 - 1e-6)),
                     "winners called": f"{int(fav.finished_p1.sum())}/{len(fav)}"})
    return pd.DataFrame(rows).set_index("model").sort_values("brier")

print(report(preds, list(MODELS) + ["quali-rate table", "pole wins"]).round(4))
