# %%
from lightgbm import LGBMClassifier
import pandas as pd
from sklearn.metrics import brier_score_loss

# %%
FEATURES = ["quali_position", "field_size", "driver_form",
            "constructor_form", "sprint_finish_position"]

df = pd.read_csv("data/features.csv")

upcoming = df[df.finished_p1.isna()]
df = df[df.finished_p1.notna()]

races = df.drop_duplicates("race_slug").sort_values("date")[["race_slug", "date", "season"]]

# %%
def walk_forward(features, start_season=2025):
    out = []
    for slug, date in races.loc[races.season >= start_season, ["race_slug", "date"]].values:
        train = df[df.date < date]
        test = df[df.race_slug == slug].copy()
        model = LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=7, verbose=-1)
        model.fit(train[features], train.finished_p1)
        p_raw = model.predict_proba(test[features])[:, 1]
        test["p"] = p_raw / p_raw.sum()
        test["p_pole"] = (test.quali_position == 1).astype(float)
        out.append(test)
    return pd.concat(out)

def score(preds, name="p"):
    n = preds.race_slug.nunique()
    brier = brier_score_loss(preds.finished_p1, preds[name])
    hits = preds.loc[preds.groupby("race_slug")[name].idxmax(), "finished_p1"].sum()
    return f"brier {brier:.4f}  hit {hits}/{n}"

# %%
preds = walk_forward(FEATURES)
print("model:", score(preds))
print("pole: ", score(preds, "p_pole"))
