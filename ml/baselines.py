# %%
import pandas as pd
from sklearn.metrics import brier_score_loss

df = pd.read_csv("data/features.csv")
df = df[df.finished_p1.notna()]

print(len(df), "rows,", df.race_slug.nunique(), "races,", int(df.finished_p1.sum()), "winners")

# %%
# Pole baseline: the quali P1 gets probability 1, everyone else 0.
df["p_pole"] = (df.quali_position == 1).astype(float)

no_pole = (df.groupby("race_slug").p_pole.max() == 0).sum()
print("races with no pole row:", no_pole)

print("pole brier:", brier_score_loss(df.finished_p1, df.p_pole))

# %%
winners = df.loc[df.finished_p1 == 1, ["race_slug", "date", "driver_code"]]
winners.head()
# %%
winners = winners.sort_values("date")
winners["prev_winner"] = winners.driver_code.shift(1)
winners.head()
# %%
df = df.merge(winners[["race_slug", "prev_winner"]], on="race_slug", how="left")
df[["race_slug", "driver_code", "prev_winner"]].head(25)
# %%
len(df)

# %%
df["p_last"] = (df.driver_code == df.prev_winner).astype(float)
print("last-winner brier:", brier_score_loss(df.finished_p1, df.p_last))

# %%
def hit_rate(p):
    picked = df[p == 1]
    return picked["finished_p1"].sum() / df.race_slug.nunique()

print("pole hit rate:", hit_rate(df.p_pole))
print("last-winner hit rate:", hit_rate(df.p_last))

