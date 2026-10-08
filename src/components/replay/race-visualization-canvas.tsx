import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { ReplayView } from "./types";
import { TIMING_TOWER_ID } from "./live-timing-tower";
import {
  classifyReplayEvent,
  getDriverPointForLap,
  getReplayEventMarkerColor,
  getRetirementLapByDriver,
  isHollowMarker,
  ReplayRaceControl,
  withFocusLast,
} from "./replay-state";
import { motion, MotionValue, useTransform } from "framer-motion";
import {
  CHART_EVENT_KINDS,
  FALLBACK_SIZE,
  RACE_CONTROL_KINDS,
  buildPath,
  getRetiredMarkerOffset,
  getVisibleLapTicks,
  lapMovement,
  lapWindowFor,
  layoutFor,
  makeLapX,
  makePositionY,
  minFrameHeight,
  trailPositions,
  withGrid,
  type ChartSize,
} from "./chart-layout";
import { AnimatedCar } from "./car-layers";

export function RaceVisualizationCanvas({
  visualization,
  currentLap,
  nextLap,
  lapProgress,
  raceControl,
  className,
  focusedDriverId,
  highlightedDriverId,
  onToggleDriver,
  onHoverDriver,
  onJumpToLap,
  minimal = false,
}: {
  visualization: ReplayView;
  currentLap: number;
  nextLap: number;
  lapProgress: MotionValue<number>;
  raceControl: ReplayRaceControl;
  className?: string;
  /** The driver held by a click — what `aria-pressed` and the label report. */
  focusedDriverId: string | null;
  /** The driver drawn at full strength: the hovered one, else the clicked one. */
  highlightedDriverId: string | null;
  onToggleDriver: (driverId: string) => void;
  onHoverDriver: (driverId: string | null) => void;
  /** Clicking an event dot jumps here. The story timeline is the keyboard path. */
  onJumpToLap?: (lap: number) => void;
  /** Just the plot, sized by its parent: no title, chips or minimum height. */
  minimal?: boolean;
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

  // A grid column before lap 1 when the race has a starting order, so a line
  // begins where the car started.
  const firstLap = drivers.some((entry) => entry.grid) ? 0 : 1;
  const lapWindow = useMemo(
    () => lapWindowFor(frameWidth, currentLap, summary.maxLap || race.laps, firstLap),
    [frameWidth, currentLap, summary.maxLap, race.laps, firstLap],
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
    [...(firstLap === 0 ? [0] : []), ...laps].filter(
      (lap) => lap >= lapWindow.from && lap <= lapWindow.to,
    ),
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
    const nextWindow = lapWindowFor(frameWidth, nextLap, summary.maxLap || race.laps, firstLap);
    return (nextWindow.from - lapWindow.from) * lapWidth;
  }, [frameWidth, layout, margin, lapWindow, nextLap, race.laps, summary.maxLap, firstLap]);
  const panX = useTransform(lapProgress, (p) => -panDistance * p);
  // Scoped to this chart: the landing page renders a second player, and a
  // duplicate clipPath id would have both of them clipped by whichever mounted
  // last.
  const plotClipId = `${useId()}-plot`;
  const retirementEventByDriver = useMemo(
    () => getRetirementLapByDriver(visualization.events, drivers),
    [visualization.events, drivers],
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
        const visiblePositions = withGrid(entry.positions, entry.grid).filter(
          (position) => retirementLap === null || position.lap <= retirementLap,
        );
        const currentPoint = getDriverPointForLap(entry.positions, currentLap);
        const nextPoint = getDriverPointForLap(entry.positions, isCarActive ? nextLap : currentLap);
        const markerPoint =
          retirementLap !== null ? getDriverPointForLap(entry.positions, retirementLap) : null;
        const fullPath = buildPath(visiblePositions, lapX, positionY);
        const trail = buildPath(
          trailPositions(visiblePositions, currentLap, isCarActive),
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
      {minimal ? null : <div className="border-b border-white/10 px-1 pb-4">
        {/* Compact on purpose: the header used to take a third of the screen
            (a three-line title beside a boxed control card), which is what
            pushed the chart below the fold. The controls are the dock now. */}
        {/* One eyebrow line carries the round and the facts, so the title has
            nothing beside it: stats pushed to the far right left a wide gap
            between the two that read as empty space. Plain text, not chips,
            because none of it is pressable. The flag count is what the chart
            draws, not what the race recorded. */}
        <p className="tabular text-eyebrow font-semibold uppercase text-white/55">
          {race.season} · Round {race.round}
          <span className="font-medium"> · {summary.driverCount} drivers · {summary.maxLap || race.laps} laps · {chartEvents.length} flags</span>
        </p>
        <h3 className="font-heading mt-1 break-words text-2xl font-bold leading-tight tracking-tight text-white">
          {race.name}
        </h3>

        {/* The second way in to the same state — the timing tower's rows are
            the first. One row that scrolls sideways rather than two that wrap:
            the tower beside it already lists every driver, so this earns one
            line and no more. The scrollbar is hidden (wheel, trackpad and touch
            still scroll it) and the right edge fades out to say there is more. */}
        <ul data-testid="driver-chips" className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)] [&::-webkit-scrollbar]:hidden">
          {drivers.map((entry) => {
            const isFocused = entry.driver.id === focusedDriverId;
            const isHighlighted = entry.driver.id === highlightedDriverId;

            return (
              <li key={entry.driver.id} className="shrink-0">
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
      </div>}

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
      <div
        ref={frame}
        className={cn("min-h-0 flex-1", !minimal && "mt-4 min-h-[32rem] sm:min-h-[var(--frame-min)]")}
        style={{ "--frame-min": `${minFrameHeight(summary.maxPosition)}px` } as React.CSSProperties}
      >
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

            {/* The lap as a ghost behind the plot, ticking with the replay.
                Decoration: the chart's label already says which lap it is. */}
            <g aria-hidden style={{ pointerEvents: "none" }}>
              <text
                x={margin.left + (layout.width - margin.left - margin.right) / 2}
                y={margin.top + (layout.height - margin.top - margin.bottom) / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(240, (layout.height - margin.top - margin.bottom) * 0.4)}
                fontWeight="800"
                fill="rgba(255,255,255,0.06)"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {currentLap}
              </text>
              <text
                x={margin.left + (layout.width - margin.left - margin.right) / 2}
                y={margin.top + (layout.height - margin.top - margin.bottom) / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={layout.compact ? "10" : "12"}
                fontWeight="700"
                letterSpacing="0.5em"
                fill="rgba(255,255,255,0.18)"
              >
                LAP · OF {summary.maxLap || race.laps}
              </text>
            </g>

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
                    {lap === 0 ? "Grid" : layout.compact ? lap : `Lap ${lap}`}
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

              const cy = margin.top - layout.eventRowGap;

              return (
                <g
                  key={`${event.lap}-${event.type}-${eventIndex}`}
                  onClick={onJumpToLap ? () => onJumpToLap(event.lap) : undefined}
                  className={onJumpToLap ? "cursor-pointer" : undefined}
                >
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
                    {isHollowMarker(kind) ? null : (
                      <circle cx={cx} cy={cy} r="2" fill={color} />
                    )}
                    {/* Pings as the playhead reaches it; keyed on the lap so a
                        replay that comes back round pings again. */}
                    {event.lap === currentLap ? (
                      <circle
                        key={currentLap}
                        className="hotspot-ping"
                        cx={cx}
                        cy={cy}
                        r={layout.compact ? "4" : "6"}
                        fill="none"
                        stroke={color}
                        strokeWidth="2"
                      />
                    ) : null}
                    {/* A finger-sized target around a 6px dot. */}
                    {onJumpToLap ? <circle cx={cx} cy={cy} r="12" fill="transparent" /> : null}
                </g>
              );
            })}

            {/* Two passes over the same order: every line, then every badge. In
                one pass a car's line is painted after the cars sorted before
                it, and cuts across their badges whenever two of them swap. */}
            {(["lines", "cars"] as const).map((layer) => withFocusLast(
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
                  key={`${layer}-${frame.entry.driver.id}`}
                  layer={layer}
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
            }))}
            </motion.g>
          </svg>
        </div>
      </div>

      <div className="mt-5 flex justify-end border-t border-white/10 px-4 pt-5 text-eyebrow font-bold uppercase">
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
