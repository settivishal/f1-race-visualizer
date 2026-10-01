"use client";

import { useMemo, useState } from "react";
import { getReplayEventTone, type ReplayRaceControl } from "./replay-state";
import { RaceStoryTimeline } from "./race-story-timeline";
import { activeMomentAt, buildStoryMoments, significanceOf, type StoryKind } from "./story-moments";
import type { ReplayView } from "./types";

/**
 * The race story: a lap axis and one line saying where the replay is.
 *
 * This was a full-width card below the whole player — a header, a static
 * paragraph of product copy, a nested panel of counters, and a scrolling box of
 * moment cards. It said what happened but not where, nothing in it was
 * clickable, and it sat far enough below the canvas that you could not read it
 * and watch at the same time.
 *
 * What replaced it is the timeline plus this strip, both sitting directly under
 * the canvas. Everything the old panel showed is still here; it is one row
 * instead of a page.
 */

type FilterId = StoryKind | "key" | "all";

/**
 * "Key moments" leads and is the default. The archive files an overtake per
 * position change, so "all" on a normal race is a hundred and eighty markers —
 * everything is there, but nothing is legible. See `significanceOf`.
 */
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "key", label: "Key moments" },
  { id: "control", label: "Race control" },
  { id: "strategy", label: "Pit stops" },
  { id: "overtake", label: "Position swings" },
  { id: "all", label: "All" },
];

export function RaceStoryPanel({
  visualization,
  currentLap,
  raceControl,
  onJumpToLap,
}: {
  visualization: ReplayView;
  currentLap: number;
  raceControl: ReplayRaceControl;
  /** Named drivers, not counts: the panel used to render bare integers. */
  onJumpToLap: (lap: number) => void;
}) {
  const [filter, setFilter] = useState<FilterId>("key");

  const moments = useMemo(() => buildStoryMoments(visualization), [visualization]);
  const shown = useMemo(() => {
    if (filter === "all") return moments;
    if (filter === "key") return moments.filter((moment) => significanceOf(moment) === "major");
    return moments.filter((moment) => moment.kind === filter);
  }, [filter, moments]);
  const active = useMemo(() => activeMomentAt(shown, currentLap), [shown, currentLap]);

  return (
    <div className="space-y-3">
      <RaceStoryTimeline
        moments={shown}
        laps={visualization.laps}
        currentLap={currentLap}
        activeMomentId={active?.id ?? null}
        onJumpToLap={onJumpToLap}
      />

      <div className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-xl border border-line bg-panel px-4 py-4 sm:px-5">
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-eyebrow font-bold uppercase ${getReplayEventTone(
            raceControl.status === "green" ? "green" : raceControl.status,
          )}`}
        >
          {raceControl.label}
        </span>

        {/* The one thing on the page that changes as the replay runs and is not
            visible as motion, so it is announced. */}
        <p className="min-w-48 flex-1 text-sm leading-6" aria-live="polite">
          {active ? (
            <>
              <span className="tabular font-semibold text-muted">Lap {active.lap}</span>{" "}
              <span className="font-semibold">{active.title}</span>
              {active.description ? (
                <span className="text-muted"> — {active.description}</span>
              ) : null}
            </>
          ) : (
            <span className="text-muted">
              {moments.length === 0
                ? "No race-control messages were published for this race."
                : "Nothing has happened yet at this lap."}
            </span>
          )}
        </p>


        {/* Scrolls rather than wraps: five filters wrapping to three rows on a
            phone took more height than the thing they filter. */}
        <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              aria-pressed={filter === option.id}
              className={`tap inline-flex shrink-0 items-center rounded-full px-3 py-1 text-eyebrow font-bold uppercase transition-colors ${
                filter === option.id
                  ? "bg-accent-fill text-on-accent"
                  : "border border-line text-muted hover:border-line-strong hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

