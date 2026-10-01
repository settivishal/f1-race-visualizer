"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { RaceStoryPanel } from "./race-story-panel";
import { RaceVisualizationCanvas } from "./race-visualization-canvas";
import {
  buildRaceControlByLap,
  describeMissingLaps,
  nearestLapIndex,
} from "./replay-state";
import { ReplayControls } from "./replay-controls";
import { LiveTimingTower } from "./live-timing-tower";
import type { ReplayView } from "./types";
import { MotionConfig, animate, useMotionValue, useReducedMotion } from "framer-motion";

const BASE_LAP_DURATION_MS = 1600;
const DEFAULT_SPEED = 1;

export function RaceVisualizationPlayer({
  visualization,
  storyPanel = true,
  initialLap,
}: {
  visualization: ReplayView;
  storyPanel?: boolean;
  /**
   * The lap to open on, from `?lap=` in the URL — so a moment in a race can be
   * linked to. A lap that does not exist lands on the nearest one that does
   * rather than failing: upstream leaves lap ranges missing, so a perfectly
   * reasonable lap number can have no data behind it.
   */
  initialLap?: number;
}) {
  const startIndex = useMemo(
    () => nearestLapIndex(visualization.laps, initialLap),
    [visualization.laps, initialLap],
  );
  const [currentLapIndex, setCurrentLapIndex] = useState(startIndex);
  const lapProgress = useMotionValue(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Which driver the chart draws at full strength, or null for the whole
  // field. A way of looking rather than a place in the race, so unlike `?lap=`
  // it stays here and out of the URL.
  const [focusedDriverId, setFocusedDriverId] = useState<string | null>(null);
  // Hovering a driver previews the same emphasis without committing to it, so
  // reading the field is a sweep of the pointer rather than a click per driver.
  // A hover wins while it lasts; letting go falls back to whatever was clicked.
  const [hoveredDriverId, setHoveredDriverId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const shouldReduceMotion = useReducedMotion();

  const laps = visualization.laps;
  const currentLap = laps[currentLapIndex] ?? 1;
  const nextLap = laps[Math.min(currentLapIndex + 1, Math.max(0, laps.length - 1))] ?? currentLap;
  const canAdvance = currentLapIndex < Math.max(0, laps.length - 1);


  const replayProgressPercent =
    laps.length <= 1 ? 100 : (currentLapIndex / Math.max(1, laps.length - 1)) * 100;
  const raceControlByLap = useMemo(
    () => buildRaceControlByLap(laps, visualization.events),
    [laps, visualization.events],
  );
  const activeRaceControl = raceControlByLap.get(currentLap) ?? {
    status: "green" as const,
    label: "Green Flag",
    details: null,
  };
  const missingLapsNotice = useMemo(
    () => describeMissingLaps(laps, visualization.race.laps),
    [laps, visualization.race.laps],
  );
  // Hoisted out of the controls so the timeline's markers and the scrubber
  // are the same action rather than two copies of it.
  const highlightedDriverId = hoveredDriverId ?? focusedDriverId;
  const toggleFocusedDriver = useCallback((driverId: string) => {
    setFocusedDriverId((current) => (current === driverId ? null : driverId));
  }, []);
  const jumpToLap = useCallback(
    (lap: number) => {
      setIsPlaying(false);
      lapProgress.set(0);
      setCurrentLapIndex(Math.max(0, laps.findIndex((entry) => entry === lap)));
    },
    [laps, lapProgress],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentLapIndex(startIndex);
    lapProgress.set(0);
    setIsPlaying(false);
    setSpeed(DEFAULT_SPEED);
    // A new race must not open with the previous race's driver focused.
    setFocusedDriverId(null);
    setHoveredDriverId(null);
    // lapProgress is a MotionValue and keeps the same identity for the life of
    // the component, so listing it changes nothing at runtime and satisfies the
    // rule honestly rather than by suppressing it.
  }, [visualization, lapProgress, startIndex]);

  useEffect(() => {
    if (!isPlaying || !canAdvance) {
      return;
    }

    const advance = () => {
      lapProgress.set(0);
      setCurrentLapIndex((currentIndex) => {
        const nextIndex = Math.min(currentIndex + 1, Math.max(0, laps.length - 1));
        if (nextIndex >= Math.max(0, laps.length - 1)) {
          setIsPlaying(false);
        }
        return nextIndex;
      });
    };

    // Under a reduced-motion preference the cars step from lap to lap rather
    // than sliding between them: `lapProgress` stays at 0, so each car renders
    // at its position for the current lap and jumps to the next.
    //
    // A continuously animating position chart is the pattern the preference
    // exists for. What it must not do is take the feature away — playback, the
    // speed control, the scrubber, the timing tower and the keyboard shortcuts
    // all behave exactly as they otherwise would. Only the interpolation stops.
    if (shouldReduceMotion) {
      const timer = setTimeout(advance, BASE_LAP_DURATION_MS / speed);
      return () => clearTimeout(timer);
    }

    const duration = (BASE_LAP_DURATION_MS / speed) * (1 - lapProgress.get());

    const controls = animate(lapProgress, 1, {
      duration: duration / 1000,
      ease: "linear",
      onComplete: advance,
    });

    return () => {
      controls.stop();
    };
  }, [
    canAdvance,
    isPlaying,
    laps.length,
    speed,
    lapProgress,
    currentLapIndex,
    shouldReduceMotion,
  ]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        // Buttons included: Space is how a focused button is activated, and a
        // shortcut that also fires on it makes every control do two things at
        // once. The Play button still plays — through its own click.
        target instanceof HTMLButtonElement
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((current) => !current);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        if (canAdvance) {
          setIsPlaying(false);
          lapProgress.set(0);
          setCurrentLapIndex((current) => Math.min(current + 1, Math.max(0, laps.length - 1)));
        }
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        setIsPlaying(false);
        lapProgress.set(0);
        setCurrentLapIndex((current) => Math.max(current - 1, 0));
      } else if (event.code === "Escape") {
        setFocusedDriverId(null);
      } else if (event.code === "Home") {
        event.preventDefault();
        setIsPlaying(false);
        lapProgress.set(0);
        setCurrentLapIndex(0);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [canAdvance, laps.length, lapProgress]);

  return (
    // `reducedMotion="user"` makes every framer-motion animation below here
    // follow the preference, including the timing tower's spring reordering,
    // which this component does not otherwise control. The CSS rule in
    // globals.css cannot reach JS-driven animation; this is its counterpart.
    <MotionConfig reducedMotion="user">
      <div className="space-y-5" aria-label={`${visualization.race.name} replay`} role="region">
        {/* The shortcuts work whether or not this is read, but a control nobody
            can discover is not really operable. Visible to screen readers and on
            keyboard focus; out of the way otherwise. */}
        <p className="sr-only focus-within:not-sr-only" tabIndex={0}>
          Keyboard: Space plays and pauses, Left and Right arrows step one lap,
          Home returns to lap one, Escape clears a focused driver. The live timing tower lists the running order
          for the current lap as text.
        </p>
        {/* No overflow-x here. It used to wrap the whole grid, so anything
            narrower than tower + chart minimum scrolled the tower and the
            timeline sideways along with the chart. The chart owns its own
            horizontal scroll; the rest of the page should reflow.

            items-start rather than stretch: the right column is now canvas plus
            timeline plus strip, and a stretched tower grew to match it, leaving
            a third of an empty card under the last driver. */}
        {/* Same voice and same markup as the tower's "no sector times" line:
            an absence in the source, stated, rather than a silent skip. */}
        {missingLapsNotice ? (
          <p className="rounded-xl bg-panel px-5 py-3 text-xs leading-relaxed text-muted ring-1 ring-line">
            {missingLapsNotice}
          </p>
        ) : null}
        <div className="pb-10">
          <div className="grid w-full items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
            {/* min-w-0 on both columns, and it is not cosmetic. A grid child
                defaults to `min-width: auto`, which refuses to shrink below its
                content — so the canvas's `min-w-[760px]` propagated up through
                the shared column and stretched this tower to 802px on a 390px
                screen, taking the page with it. */}
            <div className="min-w-0 max-h-[800px] lg:sticky lg:top-20">
              <LiveTimingTower
                visualization={visualization}
                currentLap={currentLap}
                nextLap={nextLap}
                lapProgress={lapProgress}
                focusedDriverId={focusedDriverId}
                highlightedDriverId={highlightedDriverId}
                onToggleDriver={toggleFocusedDriver}
                onHoverDriver={setHoveredDriverId}
              />
            </div>

            {/* The height cap belongs to the canvas, not to the column: with
                the story below it inside the column, capping the column would
                have shrunk the canvas to make room. */}
            <div className="flex min-w-0 flex-col">
              <RaceVisualizationCanvas
                // Shorter on a phone: at 600px the chart is the whole viewport
                // and you pan a window you cannot see around.
                className="sm:min-h-[600px] sm:max-h-[800px] flex-1"
                visualization={visualization}
                currentLap={currentLap}
                nextLap={nextLap}
                focusedDriverId={focusedDriverId}
                highlightedDriverId={highlightedDriverId}
                onToggleDriver={toggleFocusedDriver}
                onHoverDriver={setHoveredDriverId}
                lapProgress={lapProgress}
                raceControl={activeRaceControl}
                controls={
                  <ReplayControls
                    currentLap={currentLap}
                    maxLap={visualization.summary.maxLap || visualization.race.laps}
                    isPlaying={isPlaying}
                    speed={speed}
                    progressPercent={replayProgressPercent}
                    lapProgress={lapProgress}
                    canStepBackward={currentLapIndex > 0}
                    canStepForward={canAdvance}
                    onPlayPause={() => {
                      if (!canAdvance && currentLapIndex >= laps.length - 1) {
                        setCurrentLapIndex(0);
                        lapProgress.set(0);
                      }
                      setIsPlaying((current) => !current);
                    }}
                    onRestart={() => {
                      setIsPlaying(false);
                      setCurrentLapIndex(0);
                      lapProgress.set(0);
                    }}
                    onPrevious={() => {
                      setIsPlaying(false);
                      lapProgress.set(0);
                      setCurrentLapIndex((current) => Math.max(current - 1, 0));
                    }}
                    onNext={() => {
                      setIsPlaying(false);
                      lapProgress.set(0);
                      setCurrentLapIndex((current) =>
                        Math.min(current + 1, Math.max(0, laps.length - 1)),
                      );
                    }}
                    onJumpToLap={jumpToLap}
                    onChangeSpeed={(nextSpeed) => setSpeed(nextSpeed)}
                  />
                }
              />

              {/* Under the canvas and inside its column, so the timeline shares
                  the canvas's width and the story reads as part of the
                  instrument rather than as a section below it. */}
              {storyPanel ? (
                <div className="mt-5 shrink-0">
                  <RaceStoryPanel
                    visualization={visualization}
                    currentLap={currentLap}
                    raceControl={activeRaceControl}
                        onJumpToLap={jumpToLap}
                  />
                </div>
              ) : null}
            </div>

          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
