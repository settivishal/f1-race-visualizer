"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getReplayEventMarkerColor, isHollowMarker, type ReplayEventKind } from "./replay-state";
import type { StoryMoment } from "./story-moments";

/**
 * The race as a lap axis, directly under the canvas.
 *
 * The story used to be a scrolling box of cards below the whole player, which
 * said what happened but never where — a moment on lap 3 and a moment on lap 60
 * were two cards the same distance apart. Here position on the axis *is* the
 * lap, so a race with everything in the first ten laps looks different from one
 * that unravelled at the end.
 *
 * Every marker is a button that jumps the replay to its lap. The canvas already
 * draws markers for the same events with `getReplayEventMarkerColor`, and this
 * uses that function rather than a second palette, so a marker here and a marker
 * there cannot drift apart.
 */

/**
 * How close two markers may be, in pixels, before they become one target.
 *
 * A percentage cannot do this job. 1.6% of the rail is 19px on a desktop and
 * 6px on a phone — narrower than the marker itself, so markers overlapped
 * exactly where there was least room for them. A tap target is a physical size,
 * so the window is one too, and the rail measures itself to convert.
 */
const COLLISION_PX = 22;

/** A dot's fill, or for a hollow marker its outline over the panel. */
function markerStyle(kind: ReplayEventKind) {
  const color = getReplayEventMarkerColor(kind);
  return isHollowMarker(kind)
    ? { border: `2px solid ${color}`, backgroundColor: "var(--panel)" }
    : { backgroundColor: color };
}

type Cluster = {
  /** Percent along the axis. */
  offset: number;
  lap: number;
  moments: StoryMoment[];
};

export function clusterMoments(
  moments: StoryMoment[],
  firstLap: number,
  lastLap: number,
  /** The rail's rendered width. Until it is measured, assume a phone. */
  railWidth = 360,
): Cluster[] {
  const span = Math.max(1, lastLap - firstLap);
  const windowPercent = (COLLISION_PX / Math.max(1, railWidth)) * 100;
  const clusters: Cluster[] = [];

  for (const moment of moments) {
    const offset = ((moment.lap - firstLap) / span) * 100;
    const previous = clusters[clusters.length - 1];

    // Moments arrive lap-ordered, so only the last cluster can be within reach.
    // A safety car and the three stops it triggers land on one lap and would
    // otherwise stack into an unclickable pile.
    if (previous && offset - previous.offset <= windowPercent) {
      previous.moments.push(moment);
      continue;
    }

    clusters.push({ offset, lap: moment.lap, moments: [moment] });
  }

  return clusters;
}

/**
 * Lap labels under the rail: every 10 laps, or every 5 in a race short enough
 * (a sprint) that 10 would leave only the two ends. The first and last laps
 * are always labelled, and a regular tick closer than half a step to the last
 * one is dropped rather than printed on top of it.
 */
export function timelineTicks(firstLap: number, lastLap: number): number[] {
  if (lastLap <= firstLap) return [firstLap];
  const step = lastLap - firstLap + 1 <= 30 ? 5 : 10;
  const ticks = [firstLap];
  for (let lap = Math.ceil((firstLap + 1) / step) * step; lap < lastLap; lap += step) {
    if (lastLap - lap >= step / 2) ticks.push(lap);
  }
  ticks.push(lastLap);
  return ticks;
}

/** How many dots one lap stacks before the rest become "+n". */
const MAX_STACK = 4;

/**
 * The colour key. Kinds that share a colour on the chart share an entry here,
 * so the key never names two things a reader cannot tell apart.
 */
const KEY: { label: string; kinds: ReplayEventKind[] }[] = [
  { label: "Safety car", kinds: ["safety-car"] },
  { label: "VSC", kinds: ["virtual-safety-car"] },
  { label: "Red flag", kinds: ["red-flag"] },
  { label: "Yellow", kinds: ["yellow"] },
  { label: "Pit stop", kinds: ["pit"] },
  { label: "Double yellow", kinds: ["double-yellow"] },
  { label: "Out of the race", kinds: ["dnf", "dns", "dnq", "dsq"] },
  { label: "Penalty", kinds: ["penalty"] },
  { label: "Overtake", kinds: ["overtake"] },
  { label: "Fastest lap", kinds: ["fastest-lap"] },
];

export function RaceStoryTimeline({
  moments,
  laps,
  currentLap,
  activeMomentId,
  onJumpToLap,
}: {
  moments: StoryMoment[];
  laps: number[];
  currentLap: number;
  activeMomentId: string | null;
  onJumpToLap: (lap: number) => void;
}) {
  const firstLap = laps[0] ?? 1;
  const lastLap = laps[laps.length - 1] ?? firstLap;

  // The rail measures itself, because how close two markers may be is a
  // question about pixels and the same percentage means different things on a
  // phone and a monitor.
  const rail = useRef<HTMLDivElement>(null);
  const [railWidth, setRailWidth] = useState(0);

  useEffect(() => {
    const element = rail.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setRailWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const clusters = useMemo(
    // Zero until the first measurement lands; the default assumes a phone,
    // which errs towards merging rather than towards markers on top of markers.
    () => clusterMoments(moments, firstLap, lastLap, railWidth || undefined),
    [moments, firstLap, lastLap, railWidth],
  );

  const playhead = ((currentLap - firstLap) / Math.max(1, lastLap - firstLap)) * 100;
  const ticks = timelineTicks(firstLap, lastLap);
  // Only what this race has: a key listing red flags under a race without one
  // is a legend for a different chart.
  const key = useMemo(() => {
    const present = new Set(moments.map((moment) => moment.eventKind));
    return KEY.filter((entry) => entry.kinds.some((kind) => present.has(kind)));
  }, [moments]);

  return (
    <div className="rounded-xl border border-line bg-panel px-5 pb-4 pt-5">
      <div className="flex items-baseline justify-between text-eyebrow font-semibold uppercase text-muted">
        <span>Race timeline</span>
        <span className="tabular">
          {moments.length} {moments.length === 1 ? "moment" : "moments"}
        </span>
      </div>

      {/* Tall enough for a four-moment lap to stack above the rail. */}
      <div ref={rail} className="relative mt-4 h-16">
        <div className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-panel-strong" />
        {/* The race so far, so the rail reads as filling up. */}
        <div
          className="absolute bottom-0 left-0 h-1 rounded-full bg-accent/50"
          style={{ width: `${Math.max(0, Math.min(100, playhead))}%` }}
        />

        {clusters.map((cluster) => {
          const isActive = cluster.moments.some((moment) => moment.id === activeMomentId);
          const isPast = cluster.lap <= currentLap;
          const label =
            cluster.moments.length === 1
              ? `${cluster.moments[0].title}, lap ${cluster.lap}`
              : `${cluster.moments.length} moments on lap ${cluster.lap}: ${cluster.moments
                  .map((moment) => moment.title)
                  .join(", ")}`;
          const shown = cluster.moments.slice(0, MAX_STACK);
          const hidden = cluster.moments.length - shown.length;

          return (
            // One dot per moment, each in its own colour, stacked up from the
            // rail: a busy lap is taller, and a pit stop and a retirement on
            // the same lap look like two things rather than one.
            <button
              key={`${cluster.lap}-${cluster.moments[0].id}`}
              type="button"
              onClick={() => onJumpToLap(cluster.lap)}
              title={label}
              aria-label={label}
              className={`tap group absolute -bottom-[3px] flex -translate-x-1/2 flex-col-reverse items-center gap-0.5 rounded-sm px-1.5 transition-transform hover:scale-110 ${
                isActive ? "scale-110" : ""
              }`}
              style={{ left: `${cluster.offset}%` }}
            >
              {shown.map((moment) => (
                <span
                  key={moment.id}
                  aria-hidden
                  // The dots fade for laps still ahead, not the whole button:
                  // faded, the "+n" label fell to 2:1 contrast.
                  className={`block h-2.5 w-2.5 rounded-full ring-2 ring-panel ${isPast ? "" : "opacity-45"}`}
                  style={markerStyle(moment.eventKind)}
                />
              ))}
              {hidden > 0 ? (
                <span aria-hidden className="tabular text-[10px] font-bold leading-none text-muted">
                  +{hidden}
                </span>
              ) : null}
            </button>
          );
        })}

        {/* The playhead crosses the rail: it is the thing that moves. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-2 h-5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          style={{ left: `${Math.max(0, Math.min(100, playhead))}%` }}
        />
      </div>

      <div className="relative mt-3 h-4 text-eyebrow font-semibold uppercase text-subtle">
        {ticks.map((lap, index) => (
          <span
            key={lap}
            className={`tabular absolute top-0 ${
              index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
            }`}
            style={{ left: `${((lap - firstLap) / Math.max(1, lastLap - firstLap)) * 100}%` }}
          >
            {/* A bare number on a phone, as on the chart's axis: "Lap 1" is wide
                enough there to run into the next tick. */}
            {index === 0 ? <span className="hidden sm:inline">Lap </span> : null}
            {lap}
          </span>
        ))}
      </div>

      {key.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
          {key.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={markerStyle(entry.kinds[0])}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
