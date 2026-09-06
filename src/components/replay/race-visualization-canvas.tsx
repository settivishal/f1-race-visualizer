"use client";

import { ReactNode } from "react";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import type { ReplayEntry, ReplayEvent, ReplayPosition, ReplaySummary, ReplayView } from "./types";
import { RaceCar } from "./race-car";
import { TIMING_TOWER_ID } from "./live-timing-tower";
import {
  classifyReplayEvent,
  DriverReplayState,
  getReplayEventMarkerColor,
  ReplayRaceControl,
} from "./replay-state";
import { motion, MotionValue, useTransform } from "framer-motion";

const VIEWBOX_WIDTH = 1120;
const VIEWBOX_HEIGHT = 640;
const MARGIN = {
  top: 80,
  right: 120,
  bottom: 68,
  left: 176,
};

function getLapX(lap: number, maxLap: number) {
  const innerWidth = VIEWBOX_WIDTH - MARGIN.left - MARGIN.right;

  if (maxLap <= 1) {
    return MARGIN.left + innerWidth / 2;
  }

  return MARGIN.left + ((lap - 1) / (maxLap - 1)) * innerWidth;
}

function getPositionY(position: number, maxPosition: number) {
  const innerHeight = VIEWBOX_HEIGHT - MARGIN.top - MARGIN.bottom;

  if (maxPosition <= 1) {
    return MARGIN.top + innerHeight / 2;
  }

  return MARGIN.top + ((position - 1) / (maxPosition - 1)) * innerHeight;
}

function buildPath(
  positions: ReplayPosition[],
  maxLap: number,
  maxPosition: number,
) {
  return positions
    .map((entry, index) => {
      const x = getLapX(entry.lap, maxLap);
      const y = getPositionY(entry.position, maxPosition);
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function getPointForLap(
  positions: ReplayPosition[],
  lap: number,
) {
  let candidate = positions[0];

  for (const entry of positions) {
    if (entry.lap === lap) {
      return entry;
    }

    if (entry.lap < lap) {
      candidate = entry;
    }
  }

  return candidate ?? positions[0];
}

function getVisibleLapTicks(laps: number[]) {
  if (laps.length <= 12) {
    return laps;
  }

  const step = Math.ceil(laps.length / 8);
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
  driverStates,
  controls,
  className,
}: {
  visualization: ReplayView;
  currentLap: number;
  nextLap: number;
  lapProgress: MotionValue<number>;
  raceControl: ReplayRaceControl;
  driverStates: Map<string, DriverReplayState>;
  controls?: ReactNode;
  className?: string;
}) {
  const { race, summary, laps, drivers } = visualization;
  const lapTicks = getVisibleLapTicks(laps);
  const activeLapX = useTransform(lapProgress, (p) => getLapX(currentLap + (nextLap - currentLap) * p, summary.maxLap));
  const retirementEventByDriver = useMemo(
    () => getRetirementLapByDriver(visualization.events),
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
        const currentPoint = getPointForLap(entry.positions, currentLap);
        const nextPoint = getPointForLap(entry.positions, isCarActive ? nextLap : currentLap);
        const markerPoint =
          retirementLap !== null ? getPointForLap(entry.positions, retirementLap) : null;
        const fullPath = buildPath(visiblePositions, summary.maxLap, summary.maxPosition);
        const trail = buildPath(
          visiblePositions.filter((position) => position.lap <= currentLap),
          summary.maxLap,
          summary.maxPosition,
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
      nextLap,
      retirementEventByDriver,
      summary.maxLap,
      summary.maxPosition,
    ],
  );
  const retiredFrames = currentDriverFrames.filter((frame) => frame.isRetiredAtCurrentLap);
  const activeFrames = currentDriverFrames.filter((frame) => !frame.isRetiredAtCurrentLap);

  return (
    <div className={cn("overflow-hidden rounded-[2rem] border border-white/5 bg-[#0b0d10] p-5 text-white shadow-[0_24px_90px_rgba(0,0,0,0.455)] flex flex-col", className)}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-5 border-b border-white/10 px-4 pb-5">
        <div className="max-w-md md:max-w-xl flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e10600]">Visualization Engine</p>
          <h3 className="font-heading mt-2 text-2xl sm:text-3xl leading-tight tracking-[0.04em] text-white break-words">
            {race.season} R{race.round} • {race.name}
          </h3>
          <div className="mt-3.5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 font-semibold text-white/90">
              {summary.driverCount} Drivers
            </span>
            <span className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 font-semibold text-white/90">
              {summary.maxLap || race.laps} Laps
            </span>
            <span className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 font-semibold text-white/90">
              {visualization.events.length} Events
            </span>
          </div>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3 flex-shrink-0">
          {controls ? <div>{controls}</div> : null}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px]">
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            role="img"
            aria-label={`${race.name} race position chart, lap ${currentLap} of ${
              summary.maxLap || race.laps
            }`}
            aria-describedby={TIMING_TOWER_ID}
            className="h-auto w-full"
          >
            {/* Dark background panel */}
            <rect
              x="0"
              y="0"
              width={VIEWBOX_WIDTH}
              height={VIEWBOX_HEIGHT}
              rx="28"
              fill="#060709"
            />

            {/* Glowing active lap scrubber line */}
            <motion.line
              style={{ x: activeLapX }}
              y1={MARGIN.top - 32}
              y2={VIEWBOX_HEIGHT - MARGIN.bottom}
              stroke="#e10600"
              strokeWidth="2.5"
              opacity="0.85"
              filter="drop-shadow(0px 0px 3px rgba(225,6,0,0.6))"
            />
            {/* Top glowing handle for active line */}
            <motion.g style={{ x: activeLapX, y: MARGIN.top - 32 }}>
              <circle r="6" fill="#e10600" />
              <circle r="2.5" fill="white" />
            </motion.g>

            {/* Horizontal position grid lines */}
            {Array.from({ length: summary.maxPosition }, (_, index) => {
              const position = index + 1;
              const y = getPositionY(position, summary.maxPosition);

              return (
                <g key={`position-${position}`}>
                  <line
                    x1={MARGIN.left}
                    y1={y}
                    x2={VIEWBOX_WIDTH - MARGIN.right}
                    y2={y}
                    stroke={position === 1 ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.045)"}
                    strokeWidth="1"
                  />
                  <text
                    x={MARGIN.left - 42}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="13"
                    fontWeight="700"
                    fill="rgba(255,255,255,0.68)"
                    style={{ fontFamily: "monospace" }}
                  >
                    P{position}
                  </text>
                </g>
              );
            })}

            {/* Vertical lap grid lines */}
            {lapTicks.map((lap) => {
              const x = getLapX(lap, summary.maxLap);

              return (
                <g key={`lap-${lap}`}>
                  <line
                    x1={x}
                    y1={MARGIN.top}
                    x2={x}
                    y2={VIEWBOX_HEIGHT - MARGIN.bottom}
                    stroke="rgba(255,255,255,0.045)"
                    strokeWidth="1"
                  />
                  <text
                    x={x}
                    y={VIEWBOX_HEIGHT - MARGIN.bottom + 28}
                    textAnchor="middle"
                    fontSize="12"
                    fill="rgba(255,255,255,0.68)"
                    style={{ fontFamily: "monospace" }}
                  >
                    Lap {lap}
                  </text>
                </g>
              );
            })}

            {/* Telemetry Event Markers with concentric design */}
            {visualization.events.map((event, eventIndex) => {
              const cx = getLapX(event.lap, summary.maxLap);
              const kind = classifyReplayEvent(event);
              const color = getReplayEventMarkerColor(kind);

              return (
                <g key={`${event.lap}-${event.type}-${eventIndex}`}>
                    <line
                      x1={cx}
                      y1={MARGIN.top - 48}
                      x2={cx}
                      y2={VIEWBOX_HEIGHT - MARGIN.bottom}
                      stroke={kind === "penalty" ? "#ef4444" : "#eab308"}
                      strokeOpacity="0.2"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx={cx}
                      cy={MARGIN.top - 48}
                      r="6"
                      fill="#0f1115"
                      stroke={color}
                      strokeWidth="2"
                    />
                    <circle cx={cx} cy={MARGIN.top - 48} r="2" fill={color} />
                </g>
              );
            })}

            {/* Render trails and active telemetry badges */}
            {[...retiredFrames, ...activeFrames].map((frame) => {
              const state = driverStates.get(frame.entry.driver.id);
              return (
                <AnimatedCar
                  key={frame.entry.driver.id}
                  frame={frame}
                  state={state}
                  raceControl={raceControl}
                  lapProgress={lapProgress}
                  summary={summary}
                  currentLap={currentLap}
                  nextLap={nextLap}
                />
              );
            })}
          </svg>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-t border-white/10 px-4 pt-5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45 lg:grid-cols-[1fr_auto] lg:items-center">
        <p>
          The replay controller drives car positions, lap progress, and event markers from the same
          synchronized race state.
        </p>
        <p className="text-[#e10600]">
          {raceControl.label} • lap {currentLap}
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
  state,
  raceControl,
  lapProgress,
  summary,
  currentLap,
  nextLap,
}: {
  frame: DriverFrame;
  state?: DriverReplayState;
  raceControl: ReplayRaceControl;
  lapProgress: MotionValue<number>;
  summary: ReplaySummary;
  currentLap: number;
  nextLap: number;
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

  const x = useTransform(lapProgress, (p) => {
    return getLapX(isCarActive ? currentLap + (nextLap - currentLap) * p : currentLap, summary.maxLap);
  });

  const y = useTransform(lapProgress, (p) => {
    const interpolatedPosition =
      currentPoint && nextPoint
        ? currentPoint.position + (nextPoint.position - currentPoint.position) * p
        : currentPoint?.position ?? nextPoint?.position ?? 1;
    return getPositionY(interpolatedPosition, summary.maxPosition);
  });

  if (!first || !last || !fullPath || !currentPoint || !nextPoint) {
    return null;
  }

  return (
    <g>
      <title>
        {driver.code} • {driver.name}
        {state?.statusLabel ? ` • ${state.statusLabel}` : ""}
        {retirementEvent ? ` • ${retirementEvent.type} lap ${retirementEvent.lap}` : ""}
      </title>
      <path
        d={fullPath}
        fill="none"
        stroke={team.color}
        strokeOpacity={isRetiredAtCurrentLap ? 0.08 : state?.isBackmarker ? 0.08 : 0.12}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="4 8"
        className="transition-opacity duration-200 hover:opacity-90"
      />

      {trail ? (
        <path
          d={trail}
          fill="none"
          stroke={team.color}
          strokeOpacity={isRetiredAtCurrentLap ? 0.36 : state?.isBackmarker ? 0.5 : 0.8}
          strokeWidth={state?.isLapped ? "2.5" : isRetiredAtCurrentLap ? "2.2" : "3.2"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={state?.isLapped ? "8 6" : undefined}
          className="transition-opacity duration-200 hover:opacity-100"
        />
      ) : null}

      {isRetiredAtCurrentLap && markerPoint ? (
        <g
          transform={`translate(${
            getLapX(markerPoint.lap, summary.maxLap) + markerOffset.x
          } ${getPositionY(markerPoint.position, summary.maxPosition) + markerOffset.y})`}
          className="opacity-90 transition-opacity duration-200 hover:opacity-100"
        >
          <circle r="8" fill="rgba(15,23,42,0.92)" stroke={team.color} strokeWidth="2.2" />
          <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      ) : null}

      {isCarActive ? (
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
          muted={Boolean(state?.isBackmarker)}
          caution={raceControl.status !== "green" || Boolean(state?.isLapped)}
        />
      ) : null}
    </g>
  );
}
