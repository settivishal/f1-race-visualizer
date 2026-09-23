"use client";

import { ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { linearScale, type Scale } from "@/lib/scale";
import type { ReplayEntry, ReplayEvent, ReplayPosition, ReplayView } from "./types";
import { RaceCar } from "./race-car";
import { TIMING_TOWER_ID } from "./live-timing-tower";
import {
  classifyReplayEvent,
  type ReplayEventKind,
  easeLapProgress,
  getDriverPointForLap,
  getReplayEventMarkerColor,
  ReplayRaceControl,
  withFocusLast,
} from "./replay-state";
import { motion, MotionValue, useTransform } from "framer-motion";

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
const FALLBACK_SIZE = { width: 1120, height: 640 };

/** Below this the chart is drawn for a phone. Tailwind's `sm`. */
const COMPACT_WIDTH = 640;

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
          // The driver badges ride the playhead rather than sitting at the
          // right edge, so this only has to clear the last lap label.
          right: 56,
          // The last row sits exactly on top + innerHeight, so its label needs
          // room below the plot or it is clipped by the container — P18 was
          // rendering as a half-height label on an eighteen-car race.
          bottom: 96,
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

/**
 * The signals that describe the race rather than one car, and so earn a rule
 * across the whole plot.
 */
const RACE_CONTROL_KINDS = new Set<ReplayEventKind>([
  "safety-car",
  "virtual-safety-car",
  "red-flag",
  "yellow",
  "double-yellow",
  "chequered",
  "green",
]);

/** Race control plus the non-finishes: a line that stops should say why. */
const CHART_EVENT_KINDS = new Set<ReplayEventKind>([
  ...RACE_CONTROL_KINDS,
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

type LapScale = Scale;

/**
 * Laps across the plot. `linearScale` already handles the one-lap window the
 * same way this used to by hand — a zero-width domain lands in the middle of
 * the range.
 */
function makeLapX({ from, to }: LapWindow, { width, margin }: ChartLayout): LapScale {
  return linearScale([from, to], [margin.left, width - margin.right]);
}

/** Laps per screen at a spacing a finger and an eye can both deal with. */
const MIN_LAP_SPACING = 16;

export function lapWindowFor(containerWidth: number, currentLap: number, maxLap: number): LapWindow {
  if (containerWidth <= 0) return { from: 1, to: Math.max(2, maxLap) };

  // One viewBox unit is one pixel now, so the plot's width on screen is the
  // container less its own margins — no scale factor in between.
  const { margin } = layoutFor({ width: containerWidth, height: FALLBACK_SIZE.height });
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

type PositionScale = Scale;

/** P1 at the top of the plot, the last classified position at the bottom. */
function makePositionY(maxPosition: number, { height, margin }: ChartLayout): PositionScale {
  return linearScale([1, maxPosition], [margin.top, height - margin.bottom]);
}

function buildPath(
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

function getVisibleLapTicks(laps: number[], maxTicks: number) {
  if (laps.length <= maxTicks) {
    return laps;
  }

  const step = Math.ceil(laps.length / maxTicks);
  return laps.filter((_, index) => index === 0 || index === laps.length - 1 || index % step === 0);
}

function isRetirementKind(event: ReplayEvent) {
  const kind = classifyReplayEvent(event);
  return kind === "dnf" || kind === "dns" || kind === "dnq" || kind === "dsq";
}

function getRetirementLapByDriver(events: ReplayEvent[]) {
  const result = new Map<string, ReplayEvent>();

  for (const event of events) {
    if (!event.driver || !isRetirementKind(event)) {
      continue;
    }

    const existing = result.get(event.driver.id);
    if (!existing || event.lap < existing.lap) {
      result.set(event.driver.id, event);
    }
  }

  return result;
}

/**
 * How many places a car changes over this lap. Zero when either end is missing
 * — upstream leaves lap ranges out, and a gap is not a move.
 */
function lapMovement(frame: DriverFrame) {
  const from = frame.currentPoint?.position;
  const to = frame.nextPoint?.position;
  return from == null || to == null ? 0 : Math.abs(from - to);
}

function getRetiredMarkerOffset(index: number) {
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

export function RaceVisualizationCanvas({
  visualization,
  currentLap,
  nextLap,
  lapProgress,
  raceControl,
  controls,
  className,
  focusedDriverId,
  highlightedDriverId,
  onToggleDriver,
  onHoverDriver,
}: {
  visualization: ReplayView;
  currentLap: number;
  nextLap: number;
  lapProgress: MotionValue<number>;
  raceControl: ReplayRaceControl;
  controls?: ReactNode;
  className?: string;
  /** The driver held by a click — what `aria-pressed` and the label report. */
  focusedDriverId: string | null;
  /** The driver drawn at full strength: the hovered one, else the clicked one. */
  highlightedDriverId: string | null;
  onToggleDriver: (driverId: string) => void;
  onHoverDriver: (driverId: string | null) => void;
}) {
  const { race, summary, laps, drivers } = visualization;

  // The chart measures itself so the window suits the space it actually has,
  // rather than a breakpoint guessing at it.
  const frame = useRef<HTMLDivElement>(null);
  // Nothing is measured until the observer fires, and the server has no box to
  // measure at all, so the old desktop size stands in until then — first paint
  // is exactly what it has always been.
  const [size, setSize] = useState<ChartSize>(FALLBACK_SIZE);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutFor(size), [size]);
  const { margin } = layout;
  const frameWidth = size.width;

  const lapWindow = useMemo(
    () => lapWindowFor(frameWidth, currentLap, summary.maxLap || race.laps),
    [frameWidth, currentLap, summary.maxLap, race.laps],
  );
  const lapX = useMemo(() => makeLapX(lapWindow, layout), [lapWindow, layout]);
  const positionY = useMemo(
    () => makePositionY(summary.maxPosition, layout),
    [summary.maxPosition, layout],
  );

  // Only the ticks inside the window, or a windowed chart labels laps it is not
  // showing.
  // A label is "Lap 40" on a desktop and a bare "40" on a phone, so they need
  // different room; either way the axis holds as many as fit and no more.
  const lapTicks = getVisibleLapTicks(
    laps.filter((lap) => lap >= lapWindow.from && lap <= lapWindow.to),
    Math.max(3, Math.floor((layout.width - margin.left - margin.right) / (layout.compact ? 44 : 110))),
  );
  // Same split as the cars: the lap's own position is a render value, and the
  // motion value carries only the travel from it.
  const playheadBaseX = lapX(currentLap);
  const playheadTravelX = lapX(nextLap) - playheadBaseX;
  const activeLapX = useTransform(lapProgress, (p) => playheadTravelX * p);

  // How far the window will move when the lap index advances, in viewBox units:
  // zero on a desktop and at both ends of the race, where the window is pinned.
  const panDistance = useMemo(() => {
    const span = lapWindow.to - lapWindow.from;
    if (span <= 0) return 0;
    const lapWidth = (layout.width - margin.left - margin.right) / span;
    const nextWindow = lapWindowFor(frameWidth, nextLap, summary.maxLap || race.laps);
    return (nextWindow.from - lapWindow.from) * lapWidth;
  }, [frameWidth, layout, margin, lapWindow, nextLap, race.laps, summary.maxLap]);
  const panX = useTransform(lapProgress, (p) => -panDistance * p);
  // Scoped to this chart: the landing page renders a second player, and a
  // duplicate clipPath id would have both of them clipped by whichever mounted
  // last.
  const plotClipId = `${useId()}-plot`;
  const retirementEventByDriver = useMemo(
    () => getRetirementLapByDriver(visualization.events),
    [visualization.events],
  );

  const chartEvents = useMemo(
    () =>
      visualization.events
        .map((event, index) => ({ event, index, kind: classifyReplayEvent(event) }))
        .filter(({ kind }) => CHART_EVENT_KINDS.has(kind)),
    [visualization.events],
  );

  const currentDriverFrames = useMemo(
    () =>
      drivers.map((entry, index) => {
        const retirementEvent = retirementEventByDriver.get(entry.driver.id);
        const retirementLap = retirementEvent?.lap ?? null;
        const isRetiredAtCurrentLap = retirementLap !== null && currentLap >= retirementLap;
        const isCarActive = retirementLap === null || currentLap < retirementLap;
        const visiblePositions = entry.positions.filter(
          (position) => retirementLap === null || position.lap <= retirementLap,
        );
        const currentPoint = getDriverPointForLap(entry.positions, currentLap);
        const nextPoint = getDriverPointForLap(entry.positions, isCarActive ? nextLap : currentLap);
        const markerPoint =
          retirementLap !== null ? getDriverPointForLap(entry.positions, retirementLap) : null;
        const fullPath = buildPath(visiblePositions, lapX, positionY);
        const trail = buildPath(
          visiblePositions.filter((position) => position.lap <= currentLap),
          lapX,
          positionY,
        );
        const markerOffset = getRetiredMarkerOffset(index);

        return {
          entry,
          currentPoint,
          fullPath,
          isCarActive,
          isRetiredAtCurrentLap,
          markerOffset,
          markerPoint,
          nextPoint,
          retirementEvent,
          trail,
        };
      }),
    [
      currentLap,
      drivers,
      lapX,
      nextLap,
      positionY,
      retirementEventByDriver,
    ],
  );
  const retiredFrames = currentDriverFrames.filter((frame) => frame.isRetiredAtCurrentLap);
  const activeFrames = currentDriverFrames.filter((frame) => !frame.isRetiredAtCurrentLap);
  const focusedDriver = drivers.find((entry) => entry.driver.id === focusedDriverId)?.driver ?? null;

  return (
    // `bg-track` and the white text on it are deliberate in both themes. The
    // chart is twenty coloured lines whose only job is to be told apart, and a
    // light ground washes the team colours out — so this panel stays a dark
    // instrument on a light page, the way a video player does. It is the one
    // surface here that does not follow the theme.
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-line-strong bg-track p-5 text-white shadow-lg", className)}>
      <div className="border-b border-white/10 px-4 pb-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          {/* min-w-0 so a long race name wraps instead of pushing the controls
              off; the chips used to live in here and inherited the squeeze. */}
          <div className="min-w-0 max-w-xl flex-1">
            <p className="text-eyebrow font-bold uppercase text-on-track-accent">Visualization Engine</p>
            <h3 className="font-heading mt-2 break-words text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">
              {race.season} R{race.round} • {race.name}
            </h3>
          </div>
          <div className="flex flex-col items-start gap-3 md:flex-shrink-0 md:items-end">
            {controls ? <div>{controls}</div> : null}
          </div>
        </div>

        {/* Their own row, full width. In the title's column they were sharing
            space with a flex-shrink-0 sibling and wrapped one-then-two. */}
        <div className="mt-3.5 flex flex-wrap gap-2 text-xs">
          <span className="tabular rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-white/90">
            {summary.driverCount} Drivers
          </span>
          <span className="tabular rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-white/90">
            {summary.maxLap || race.laps} Laps
          </span>
          <span className="tabular rounded-md border border-white/10 bg-white/5 px-2.5 py-1 font-semibold text-white/90">
            {/* What the chart draws, not what the race recorded — a "186
                Events" chip above five visible markers reads as a bug. The
                full count is the timeline's business. */}
            {chartEvents.length} Flags
          </span>
        </div>

        {/* The second way in to the same state — the timing tower's rows are
            the first. Same chip shape as the row above so the dark panel keeps
            one vocabulary, rather than importing the analysis tab's chips,
            which live on a light surface and hold a different kind of state. */}
        <ul data-testid="driver-chips" className="mt-2.5 flex flex-wrap gap-1.5">
          {drivers.map((entry) => {
            const isFocused = entry.driver.id === focusedDriverId;
            const isHighlighted = entry.driver.id === highlightedDriverId;

            return (
              <li key={entry.driver.id}>
                <button
                  type="button"
                  aria-pressed={isFocused}
                  onClick={() => onToggleDriver(entry.driver.id)}
                  onMouseEnter={() => onHoverDriver(entry.driver.id)}
                  onMouseLeave={() => onHoverDriver(null)}
                  onFocus={() => onHoverDriver(entry.driver.id)}
                  onBlur={() => onHoverDriver(null)}
                  className={cn(
                    "tabular inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold transition-[color,background-color,border-color,opacity] duration-200",
                    isHighlighted
                      ? "border-white/45 bg-white/20 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:text-white",
                    highlightedDriverId && !isHighlighted ? "opacity-60" : null,
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: entry.team.color }}
                    aria-hidden
                  />
                  {entry.driver.code}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* min-h-0 so this can shrink inside the card's flex column: without it
          an `h-auto` SVG keeps its intrinsic height, the column overflows the
          card's max height, and the bottom of the chart is cropped — which is
          what cut P18 in half on an eighteen-car race. */}
      {/* Focusable because it scrolls: a region a mouse can pan and a keyboard
          cannot reach is unusable without a pointer, which is what axe's
          scrollable-region-focusable rule is about. The chart itself carries the
          label, so this is a scroll handle rather than a second announcement. */}
      {/* No min-width and no scrolling any more. The chart shows a window of
          laps sized to this box, so it fits whatever space it is given rather
          than making the reader pan a 760px canvas on a 390px screen. */}
      {/* Portrait on a phone. The viewBox is this box, so its shape is the
          chart's shape: 390x520 puts 22 rows 21.9px apart, which is the same row
          density a 1100x640 desktop chart has. The phone shows fewer laps, not
          thinner lines — the trade already made for the lap window in #81. */}
      <div ref={frame} className="mt-4 min-h-[32rem] flex-1 sm:min-h-0">
        <div className="h-full">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            // The focus is named here as well, because dimming nineteen lines
            // is a change to the picture and `role="img"` is all a screen
            // reader has of it.
            aria-label={`${race.name} race position chart, lap ${currentLap} of ${
              summary.maxLap || race.laps
            }${focusedDriver ? `, focused on ${focusedDriver.name}` : ''}`}
            aria-describedby={TIMING_TOWER_ID}
            // `meet` letterboxes rather than crops, so a short container makes
            // a smaller chart instead of a clipped one.
            preserveAspectRatio="xMidYMid meet"
            className="h-full max-h-full w-full"
          >
            {/* Dark background panel */}
            <rect
              x="0"
              y="0"
              width={layout.width}
              height={layout.height}
              rx={layout.compact ? "16" : "28"}
              fill="var(--track)"
            />

            {/* The plot's own bounds. Everything that pans is clipped to this,
                so a lap label sliding out of the window stops at the axis
                instead of drifting into the P-number gutter — which is also
                where the trails have always overdrawn on a windowed chart.
                Open to the right and the top edge, because badges and event
                dots deliberately sit outside the plot on those sides. */}
            <defs>
              <clipPath id={plotClipId}>
                {/* 28 units of slack on the left: the lap labels are centred
                    on their tick, so a clip flush with the axis cuts "Lap 1"
                    in half. The P numbers end 42 units out, so this still
                    stops short of them. */}
                <rect
                  x={margin.left - layout.lapLabelGap}
                  y={0}
                  width={layout.width - margin.left + layout.lapLabelGap}
                  height={layout.height}
                />
              </clipPath>
            </defs>

            {/* Horizontal position grid lines. Outside the panning group: they
                are horizontal, so panning them would only shorten them at the
                right edge, and the P labels belong to the fixed axis. */}
            {Array.from({ length: summary.maxPosition }, (_, index) => {
              const position = index + 1;
              const y = positionY(position);

              return (
                <g key={`position-${position}`}>
                  <line
                    x1={margin.left}
                    y1={y}
                    x2={layout.width - margin.right}
                    y2={y}
                    stroke={position === 1 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.045)"}
                    strokeWidth="1"
                  />
                  <text
                    x={margin.left - layout.positionLabelGap}
                    y={y + 4}
                    textAnchor="end"
                    fontSize={layout.compact ? "10" : "13"}
                    fontWeight="700"
                    fill="rgba(255,255,255,0.68)"
                    style={{ fontFamily: "monospace" }}
                  >
                    P{position}
                  </text>
                </g>
              );
            })}

            {/* Everything drawn against the lap axis, panned as one.
                The window recentres on the current lap, so on a narrow screen
                it used to shift a whole lap-width the instant the lap index
                changed and the chart teleported once per lap. Sliding this
                group by the same width over the course of the lap means the
                recomputed geometry lands exactly where the slide arrived. On a
                desktop the window is the whole race, the shift is zero, and
                this group does nothing. */}
            <motion.g clipPath={`url(#${plotClipId})`} style={{ x: panX }}>
              {/* Glowing active lap scrubber line. Inside the pan, so while the
                  window is sliding the playhead holds its place on screen and
                  the race moves past it. */}
              <g transform={`translate(${playheadBaseX} 0)`}>
                <motion.line
                  // Named so a test can tell a car that moved on its own from a
                  // whole chart that shifted underneath it: the playhead rides
                  // the same lap scale, so if it moved too, the scale did.
                  data-testid="lap-playhead"
                  style={{ x: activeLapX }}
                  y1={margin.top - layout.playheadGap}
                  y2={layout.height - margin.bottom}
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  opacity="0.85"
                />
                {/* Top glowing handle for active line */}
                <motion.g style={{ x: activeLapX, y: margin.top - layout.playheadGap }}>
                  <circle r="6" fill="var(--accent)" />
                  <circle r="2.5" fill="white" />
                </motion.g>
              </g>

            {/* Vertical lap grid lines */}
            {lapTicks.map((lap) => {
              const x = lapX(lap);

              return (
                <g key={`lap-${lap}`}>
                  <line
                    x1={x}
                    y1={margin.top}
                    x2={x}
                    y2={layout.height - margin.bottom}
                    stroke="rgba(255,255,255,0.045)"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={layout.height - margin.bottom + layout.lapLabelGap}
                    textAnchor="middle"
                    fontSize={layout.compact ? "10" : "12"}
                    fill="rgba(255,255,255,0.68)"
                    style={{ fontFamily: "monospace" }}
                  >
                    {layout.compact ? lap : `Lap ${lap}`}
                  </text>
                </g>
              );
            })}

            {/* Race control, and only race control.
                This drew a dot and a full-height dashed line for every event,
                which on a race carrying 186 of them — the archive files an
                overtake per position change — put the plot behind a curtain.
                What earns a rule across the whole chart is a signal that
                applies to the whole chart: a safety car, a red flag, the
                chequered. Retirements keep a dot, because a line that stops
                should say why. Everything else is in the timeline below, which
                is the place built for listing things. */}
            {chartEvents.map(({ event, kind, index: eventIndex }) => {
              const cx = lapX(event.lap);
              const color = getReplayEventMarkerColor(kind);
              const isRaceControl = RACE_CONTROL_KINDS.has(kind);

              return (
                <g key={`${event.lap}-${event.type}-${eventIndex}`}>
                    {isRaceControl ? (
                      <line
                        x1={cx}
                        y1={margin.top - layout.eventRowGap}
                        x2={cx}
                        y2={layout.height - margin.bottom}
                        stroke={color}
                        strokeOpacity="0.25"
                        strokeDasharray="4 4"
                      />
                    ) : null}
                    <circle
                      cx={cx}
                      cy={margin.top - layout.eventRowGap}
                      r={layout.compact ? "4" : "6"}
                      fill="var(--track)"
                      stroke={color}
                      strokeWidth="2"
                    />
                    <circle cx={cx} cy={margin.top - layout.eventRowGap} r="2" fill={color} />
                </g>
              );
            })}

            {/* Render trails and active telemetry badges */}
            {withFocusLast(
              // Movers last. Two cars trading places occupy the same pixels for
              // most of the lap, and in document order the one being passed can
              // paint over the one passing it — which draws the overtake
              // backwards. Sorting by how far a car moves this lap puts the
              // action on top; a focused driver still wins over all of it.
              [...retiredFrames, ...activeFrames].sort(
                (a, b) => lapMovement(a) - lapMovement(b),
              ),
              highlightedDriverId,
            ).map((frame) => {
              return (
                <AnimatedCar
                  key={frame.entry.driver.id}
                  frame={frame}
                  isDimmed={
                    highlightedDriverId !== null && frame.entry.driver.id !== highlightedDriverId
                  }
                  raceControl={raceControl}
                  lapProgress={lapProgress}
                  currentLap={currentLap}
                  nextLap={nextLap}
                  lapX={lapX}
                  positionY={positionY}
                  compact={layout.compact}
                />
              );
            })}
            </motion.g>
          </svg>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-white/10 px-4 pt-5 text-eyebrow font-bold uppercase text-white/45 lg:grid-cols-[1fr_auto] lg:items-center">
        {/* Decorative, and uppercase with wide tracking, so on a phone it wraps
            to four lines and takes more height than the axis it sits under. The
            lap counter beside it is not decorative and stays at every width. */}
        <p className="hidden sm:block">
          The replay controller drives car positions, lap progress, and event markers from the same
          synchronized race state.
        </p>
        {/* The race-control label lives in the story strip directly below;
            printing it here as well said the same thing twice on one screen. */}
        {/* on-track-accent, not accent: this panel is a fixed dark surface in
            both themes, and the theme's own accent lands on it at 3.7:1 in
            light mode. */}
        <p className="text-on-track-accent">
          Lap {currentLap}
          {nextLap !== currentLap ? ` → ${nextLap}` : ""}
        </p>
      </div>
    </div>
  );
}

type DriverFrame = {
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

function AnimatedCar({
  frame,
  isDimmed,
  raceControl,
  lapProgress,
  currentLap,
  nextLap,
  lapX,
  positionY,
  compact,
}: {
  frame: DriverFrame;
  /** True when another driver is focused: this one drops back, it does not go. */
  isDimmed: boolean;
  raceControl: ReplayRaceControl;
  lapProgress: MotionValue<number>;
  currentLap: number;
  nextLap: number;
  lapX: LapScale;
  positionY: PositionScale;
  /** A phone: the badge comes off, the line stays. */
  compact: boolean;
}) {
  const {
    entry,
    currentPoint,
    fullPath,
    isCarActive,
    isRetiredAtCurrentLap,
    markerOffset,
    markerPoint,
    nextPoint,
    retirementEvent,
    trail,
  } = frame;
  const { driver, team, positions } = entry;
  const first = positions[0];
  const last = positions[positions.length - 1];

  // A multiplier rather than a replacement, so the weights the chart already
  // draws — a retired line fainter than a running one, a backmarker fainter
  // than the lead pack — survive being dimmed instead of flattening to one
  // value.
  const dim = isDimmed ? 0.3 : 1;

  // Where this car sits at the lap it is on, straight from the render. It used
  // to come out of the same `useTransform` as the movement, which meant a lap
  // change only reached the screen when `lapProgress` next emitted — and under
  // a reduced-motion preference `lapProgress` is set to 0 when it is already 0,
  // which emits nothing. The cars and the playhead lagged the lap counter.
  //
  // So the lap's position is a plain number, correct in the commit that
  // changed the lap, and the motion values below carry only the movement away
  // from it. At rest that offset is exactly zero, which is the whole of the
  // reduced-motion behaviour, by construction rather than by arithmetic.
  const baseX = lapX(currentLap);
  const baseY = positionY(currentPoint?.position ?? nextPoint?.position ?? 1);
  const travelX = isCarActive ? lapX(nextLap) - baseX : 0;
  const travelY =
    isCarActive && currentPoint && nextPoint
      ? positionY(nextPoint.position) - baseY
      : 0;

  const x = useTransform(lapProgress, (p) => travelX * p);
  const y = useTransform(lapProgress, (p) => travelY * easeLapProgress(p));

  if (!first || !last || !fullPath || !currentPoint || !nextPoint) {
    return null;
  }

  return (
    <g>
      {/* One string, not an expression list: React treats `title` children as
          text and warns when handed an array of more than one child. */}
      <title>
        {[
          `${driver.code} • ${driver.name}`,
          retirementEvent && `${retirementEvent.type} lap ${retirementEvent.lap}`,
        ]
          .filter(Boolean)
          .join(" • ")}
      </title>
      <path
        d={fullPath}
        fill="none"
        stroke={team.color}
        strokeOpacity={(isRetiredAtCurrentLap ? 0.08 : 0.12) * dim}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="4 8"
        className="transition-[opacity,stroke-opacity] duration-200 hover:opacity-90"
      />

      {trail ? (
        <path
          d={trail}
          fill="none"
          stroke={team.color}
          strokeOpacity={(isRetiredAtCurrentLap ? 0.36 : 0.8) * dim}
          strokeWidth={isRetiredAtCurrentLap ? "2.2" : "3.2"}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-[opacity,stroke-opacity] duration-200 hover:opacity-100"
        />
      ) : null}

      {isRetiredAtCurrentLap && markerPoint ? (
        <motion.g
          transform={`translate(${
            lapX(markerPoint.lap) + markerOffset.x
          } ${positionY(markerPoint.position) + markerOffset.y})`}
          className="hover:opacity-100"
          // Faded in rather than drawn, because it lands in the same frame the
          // badge leaves: the two crossfade instead of one popping into the
          // other's place. `reducedMotion="user"` on the player turns this into
          // an instant swap for anyone who asked for that.
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.9 * dim }}
          transition={{ duration: 0.25 }}
        >
          <circle r={compact ? 5 : 8} fill="rgba(15,23,42,0.92)" stroke={team.color} strokeWidth="2.2" />
          <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        </motion.g>
      ) : null}

      {/* Everything that moves within the lap, hung off the lap's own
          position. The translate is a plain render value, so it is right
          the moment the lap changes; the motion values inside it are the
          travel away from that point, and they are zero at rest. */}
      <g transform={`translate(${baseX} ${baseY})`}>
        {/* The lap the car is currently driving.
            `trail` is built in React from the laps already completed, so it only
            grows when the lap index does — while the badge slides continuously
            toward the next lap. That left every car detached from the end of its
            own line for the whole lap, and the line snapping a lap-width to catch
            up at the boundary. This segment is the gap: it ends on the same two
            motion values the badge rides, so the line arrives exactly where the
            recomputed `trail` picks it up. Under a reduced-motion preference
            `lapProgress` stays at 0 and the segment has no length. */}
        {isCarActive && currentPoint ? (
          <motion.line
            x1={0}
            y1={0}
            x2={x}
            y2={y}
            stroke={team.color}
            strokeOpacity={0.8 * dim}
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        ) : null}
        {/* Kept mounted for the lap the car retires on, so it fades out under the
            cross rather than blinking out from under it. */}
        {/* Twenty-two badges down a 390px screen would be a column of labels
            over the plot, and each one is 46 units wide against a 340-unit
            phone chart. The timing tower sits directly above, lists every
            driver in order as real text, and is already what this chart points
            at with `aria-describedby` — so the phone reads positions there and
            the chart keeps only its lines. */}
        {!compact && (isCarActive || retirementEvent?.lap === currentLap) ? (
          // The badge is the loudest thing on the chart, so dimming it by the
          // same factor as the lines is what actually makes a focused driver
          // stand out. `muted` stays what it always was — a backmarker — and the
          // two compound for a backmarker who is not the focused driver.
          <g opacity={dim} className="transition-opacity duration-200">
          {/* The focus dim stays an `opacity` attribute on the group above:
              framer-motion writes opacity to style, and the dim is what the
              replay e2e reads off the attribute to assert that exactly one car
              is at full strength. The retirement fade is its own layer inside. */}
          <motion.g
            animate={{ opacity: isCarActive ? 1 : 0 }}
            transition={{ duration: 0.25 }}
          >
          <RaceCar
            color={team.color}
            driverCode={driver.code}
            label={positions.length === 1 ? driver.name : undefined}
            x={x}
            y={y}
            accent={
              currentPoint.position > nextPoint.position
                ? "up"
                : currentPoint.position < nextPoint.position
                  ? "down"
                  : false
            }
            dimmed={isDimmed}
            caution={raceControl.status !== "green"}
          />
          </motion.g>
          </g>
        ) : null}
      </g>
    </g>
  );
}
