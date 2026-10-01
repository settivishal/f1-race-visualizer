"use client";

import { useSearchParams } from "next/navigation";
import { RaceVisualizationPlayer } from "./race-visualization-player";
import type { ReplayView } from "./types";

/**
 * The player, opened at `?lap=` from the URL.
 *
 * Read here in the browser rather than on the server, so the race page never
 * depends on its query string and is prerendered — replay payload included —
 * once per race instead of rendered per visit. Reading search params suspends
 * during prerender, so this sits inside the replay's Suspense boundary.
 */
export function ReplayAtLap({ visualization }: { visualization: ReplayView }) {
  const lap = Number(useSearchParams().get("lap"));
  return (
    <RaceVisualizationPlayer
      visualization={visualization}
      initialLap={Number.isFinite(lap) && lap > 0 ? lap : undefined}
    />
  );
}
