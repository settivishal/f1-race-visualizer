import { linearScale, type Scale } from "@/lib/scale";
import type { ReplayEntry, ReplayEvent, ReplayPosition } from "./types";
import type { ReplayEventKind } from "./replay-state";

/**
 * The chart is drawn at the size it is displayed.
 *
 * It used to have a fixed 1120x640 viewBox scaled to whatever box it was given.
 * On a 390px phone that is a scale factor of 0.35, so an 11px label rendered at
 * 3.8px and the box letterboxed 129px of nothing. A drawing with a fixed
 * coordinate space cannot be responsive — it can only be shrunk, and shrinking
 * type is how you get 3.8px labels.
 *
 * So one viewBox unit is one CSS pixel: `fontSize="13"` is thirteen pixels at
 * every width, and the drawing is the same shape as its container, so nothing
 * letterboxes. Everything below that used to read the two constants now reads
 * the measured size instead.
 */
export const FALLBACK_SIZE = { width: 1120, height: 640 };

/** Below this the chart is drawn for a phone. Tailwind's `sm`. */
export const COMPACT_WIDTH = 640;

export type ChartSize = { width: number; height: number };

export type ChartLayout = ChartSize & {
  margin: { top: number; right: number; bottom: number; left: number };
  /** How far outside the plot the P numbers sit. */
  positionLabelGap: number;
  /** How far below it the lap labels sit. */
  lapLabelGap: number;
  /** The row of event dots, above the plot. */
  eventRowGap: number;
  /** Where the playhead starts, above the plot and below the event dots. */
  playheadGap: number;
  /** A phone: no driver badges and no decorative caption. */
  compact: boolean;
};

/**
 * Margins scale with the space rather than being fixed, because a 96px left
 * margin is a quarter of a 390px chart. On a phone the gutter only has to hold
 * "P18"; on a desktop it holds what it always did.
 */
export function layoutFor({ width, height }: ChartSize): ChartLayout {
  const compact = width < COMPACT_WIDTH;

  return {
    width,
    height,
    margin: compact
      ? { top: 34, right: 14, bottom: 30, left: 34 }
      : {
          top: 80,
          // The driver badges ride the playhead, just to the right of it, so
          // this has to fit a badge on the last lap.
          right: 64,
          // Room for the lap labels (`lapLabelGap`) and no more. This was 96
          // to stop P18 clipping, but the clipping came from a frame too short
          // for its rows, which `minFrameHeight` now prevents.
          bottom: 48,
          // "P18" is four characters. 176 spent a sixth of the width on it.
          left: 96,
        },
    positionLabelGap: compact ? 5 : 42,
    lapLabelGap: compact ? 18 : 28,
    eventRowGap: compact ? 24 : 48,
    playheadGap: compact ? 14 : 32,
    compact,
  };
}

/** The least room one position row gets on a desktop before labels collide. */
export const MIN_ROW_HEIGHT = 20;

/**
 * The shortest desktop frame that still gives every row `MIN_ROW_HEIGHT`.
 *
 * Derived from the field rather than a fixed height: the chart is P1 to Pn,
 * so a 22-car grid needs more height than an 18-car one. Without it the frame
 * took whatever the card had left after its header, and 22 rows shared about
 * 220px — badges and P labels overlapped on lap 1.
 */
export function minFrameHeight(maxPosition: number): number {
  const { margin } = layoutFor(FALLBACK_SIZE);
  return margin.top + margin.bottom + MIN_ROW_HEIGHT * Math.max(1, maxPosition - 1);
}

/**
 * The signals that describe the race rather than one car, and so earn a rule
 * across the whole plot.
 */
export const RACE_CONTROL_KINDS = new Set<ReplayEventKind>([
  "safety-car",
  "virtual-safety-car",
  "red-flag",
  "yellow",
  "double-yellow",
  "chequered",
  "green",
]);

/**
 * Race control plus the non-finishes: a line that stops should say why. Not
 * the green that ends a caution — the cars losing their yellow already say so,
 * and a second dot per safety car would double the flag count.
 */
export const CHART_EVENT_KINDS = new Set<ReplayEventKind>([
  ...[...RACE_CONTROL_KINDS].filter((kind) => kind !== "green"),
  "dnf",
  "dns",
  "dsq",
]);

/**
 * The lap axis, over a window rather than always the whole race.
 *
 * The chart used to be a fixed 760px minimum and pan inside a scrolling box. On
 * a phone that meant scrolling in two directions to read one race, which is the
 * kind of thing that is fine in a design review and awful in a hand.
 *
 * So the axis shows as many laps as fit at a legible spacing, centred on
 * wherever the replay is, and moves with it. Fewer laps on screen rather than
 * thinner lines — and on a desktop the window is the whole race, so nothing
 * changes there.
 */
export type LapWindow = { from: number; to: number };

export type LapScale = Scale;

/**
 * Laps across the plot. `linearScale` already handles the one-lap window the
 * same way this used to by hand — a zero-width domain lands in the middle of
 * the range.
 */
export function makeLapX({ from, to }: LapWindow, { width, margin }: ChartLayout): LapScale {
  return linearScale([from, to], [margin.left, width - margin.right]);
}

/** Laps per screen at a spacing a finger and an eye can both deal with. */
export const MIN_LAP_SPACING = 16;

export function lapWindowFor(containerWidth: number, currentLap: number, maxLap: number): LapWindow {
  if (containerWidth <= 0) return { from: 1, to: Math.max(2, maxLap) };

  // One viewBox unit is one pixel now, so the plot's width on screen is the
  // container less its own margins — no scale factor in between.
  const { margin, compact } = layoutFor({ width: containerWidth, height: FALLBACK_SIZE.height });

  // A desktop always shows the whole race. Windowing is for a phone, where a
  // finger needs the spacing; on a desktop chart beside the timing tower the
  // plot is often under 900px, and a 53-lap race was showing laps 1-35 with
  // the rest scrolling in as it played.
  if (!compact) return { from: 1, to: Math.max(2, maxLap) };
  const usable = containerWidth - margin.left - margin.right;
  const fits = Math.max(6, Math.floor(usable / MIN_LAP_SPACING));

  if (fits >= maxLap) return { from: 1, to: Math.max(2, maxLap) };

  // Centred on the current lap, then pushed back inside the race at both ends
  // so the window never runs off either edge.
  const half = Math.floor(fits / 2);
  let from = Math.max(1, currentLap - half);
  const to = Math.min(maxLap, from + fits);
  from = Math.max(1, to - fits);

  return { from, to };
}

export type PositionScale = Scale;

/** P1 at the top of the plot, the last classified position at the bottom. */
export function makePositionY(maxPosition: number, { height, margin }: ChartLayout): PositionScale {
  return linearScale([1, maxPosition], [margin.top, height - margin.bottom]);
}

export function buildPath(
  positions: ReplayPosition[],
  lapX: LapScale,
  positionY: PositionScale,
) {
  return positions
    .map((entry, index) => {
      const x = lapX(entry.lap);
      const y = positionY(entry.position);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

/**
 * The laps a car's solid line runs through, up to the lap being shown.
 *
 * A car with no row for that lap — a lapped car, or the hole the source leaves
 * on a race's final lap, where only the leader is recorded — is still drawn at
 * the playhead, at its last known position. Without the extra point its line
 * stopped a lap short of its own dot.
 */
export function trailPositions(
  positions: ReplayPosition[],
  currentLap: number,
  carriedTo: boolean,
): ReplayPosition[] {
  const trail = positions.filter((position) => position.lap <= currentLap);
  const last = trail[trail.length - 1];
  if (carriedTo && last && last.lap < currentLap) trail.push({ ...last, lap: currentLap });
  return trail;
}

export function getVisibleLapTicks(laps: number[], maxTicks: number) {
  if (laps.length <= maxTicks) {
    return laps;
  }

  const step = Math.ceil(laps.length / maxTicks);
  const last = laps.length - 1;
  // The last lap is always labelled, so a regular tick less than half a step
  // before it would print on top of it ("Lap 50" under "Lap 53").
  return laps.filter(
    (_, index) => index === 0 || index === last || (index % step === 0 && last - index >= step / 2),
  );
}

/**
 * How many places a car changes over this lap. Zero when either end is missing
 * — upstream leaves lap ranges out, and a gap is not a move.
 */
export function lapMovement(frame: DriverFrame) {
  const from = frame.currentPoint?.position;
  const to = frame.nextPoint?.position;
  return from == null || to == null ? 0 : Math.abs(from - to);
}

export function getRetiredMarkerOffset(index: number) {
  const offsets = [
    { x: -12, y: -13 },
    { x: 12, y: -13 },
    { x: -12, y: 13 },
    { x: 12, y: 13 },
    { x: 0, y: -22 },
    { x: 0, y: 22 },
  ];

  return offsets[index % offsets.length];
}

export type DriverFrame = {
  entry: ReplayEntry;
  currentPoint: ReplayPosition;
  fullPath: string;
  isCarActive: boolean;
  isRetiredAtCurrentLap: boolean;
  markerOffset: { x: number; y: number };
  markerPoint: ReplayPosition | null;
  nextPoint: ReplayPosition;
  retirementEvent: ReplayEvent | undefined;
  trail: string;
};
