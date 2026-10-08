import { RaceCar } from "./race-car";
import { easeLapProgress, ReplayRaceControl } from "./replay-state";
import { motion, MotionValue, useTransform } from "framer-motion";
import { type DriverFrame, type LapScale, type PositionScale } from "./chart-layout";

/** How far a car gaining places swings out to pass, at mid-lap: a badge and a gap, so it clears the car it passes. */
const SWING_X = 50;

export function AnimatedCar({
  layer,
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
  layer: "lines" | "cars";
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
  // A car gaining places swings its badge out and back over the lap, so it
  // passes the cars it overtakes alongside them instead of sliding through
  // their badges. Only the badge: the line and its head stay on the position.
  // Zero at both ends of the lap, so a reduced-motion step never shows it.
  const gaining =
    isCarActive && currentPoint && nextPoint && currentPoint.position > nextPoint.position;
  const badgeX = useTransform(
    lapProgress,
    (p) => travelX * p + (gaining ? SWING_X * Math.sin(Math.PI * p) : 0),
  );

  if (!first || !last || !fullPath || !currentPoint || !nextPoint) {
    return null;
  }

  if (layer === "lines") return (
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
        {/* Where the car is. The badge sits to the right of it rather than on
            it, so the column of badges covers the race still to come — only
            the faint ghost paths — and never the laps already drawn. */}
        {isCarActive ? (
          <motion.circle
            cx={x}
            cy={y}
            r={compact ? 2.5 : 3.5}
            fill={team.color}
            fillOpacity={dim}
            stroke="var(--track)"
            strokeWidth="1.5"
          />
        ) : null}
      </g>
    </g>
  );

  return (
    <g>
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
            x={badgeX}
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
