"use client";

import { useEffect, useMemo, useState } from "react";

import { RaceStoryPanel } from "./race-story-panel";
import { RaceVisualizationCanvas } from "./race-visualization-canvas";
import {
  buildDriverReplayState,
  buildRaceControlByLap,
  summarizeDriverReplayState,
} from "./replay-state";
import { ReplayControls } from "./replay-controls";
import { LiveTimingTower } from "./live-timing-tower";
import type { ReplayView } from "./types";
import { useMotionValue, animate } from "framer-motion";

const BASE_LAP_DURATION_MS = 1600;
const DEFAULT_SPEED = 1;

export function RaceVisualizationPlayer({
  visualization,
  storyPanel = true,
}: {
  visualization: ReplayView;
  storyPanel?: boolean;
}) {
  const [currentLapIndex, setCurrentLapIndex] = useState(0);
  const lapProgress = useMotionValue(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

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
  const driverReplayStates = useMemo(
    () =>
      buildDriverReplayState(
        visualization.drivers,
        currentLap,
      ),
    [currentLap, visualization.drivers],
  );
  const trafficSummary = useMemo(
    () => summarizeDriverReplayState(driverReplayStates),
    [driverReplayStates],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentLapIndex(0);
    lapProgress.set(0);
    setIsPlaying(false);
    setSpeed(DEFAULT_SPEED);
    // lapProgress is a MotionValue and keeps the same identity for the life of
    // the component, so listing it changes nothing at runtime and satisfies the
    // rule honestly rather than by suppressing it.
  }, [visualization, lapProgress]);

  useEffect(() => {
    if (!isPlaying || !canAdvance) {
      return;
    }

    const duration = (BASE_LAP_DURATION_MS / speed) * (1 - lapProgress.get());

    const controls = animate(lapProgress, 1, {
      duration: duration / 1000,
      ease: "linear",
      onComplete: () => {
        lapProgress.set(0);
        setCurrentLapIndex((currentIndex) => {
          const nextIndex = Math.min(currentIndex + 1, Math.max(0, laps.length - 1));
          if (nextIndex >= Math.max(0, laps.length - 1)) {
            setIsPlaying(false);
          }
          return nextIndex;
        });
      },
    });

    return () => {
      controls.stop();
    };
  }, [canAdvance, isPlaying, laps.length, speed, lapProgress, currentLapIndex]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
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
    <div className="space-y-5" aria-label={`${visualization.race.name} replay`} role="region">
      {/* The shortcuts work whether or not this is read, but a control nobody
          can discover is not really operable. Visible to screen readers and on
          keyboard focus; out of the way otherwise. */}
      <p className="sr-only focus-within:not-sr-only" tabIndex={0}>
        Keyboard: Space plays and pauses, Left and Right arrows step one lap,
        Home returns to lap one. The live timing tower lists the running order
        for the current lap as text.
      </p>
      <div className="overflow-x-auto pb-10">
        <div className="grid w-full items-stretch gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="h-full max-h-[800px]">
            <LiveTimingTower
              visualization={visualization}
              currentLap={currentLap}
            />
          </div>

          <div className="h-full flex flex-col min-h-[600px] max-h-[800px]">
            <RaceVisualizationCanvas
              className="h-full flex-1"
              visualization={visualization}
              currentLap={currentLap}
              nextLap={nextLap}
              lapProgress={lapProgress}
              raceControl={activeRaceControl}
              driverStates={driverReplayStates}
              controls={
                <ReplayControls
                  compact
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
                  onJumpToLap={(lap) => {
                    setIsPlaying(false);
                    lapProgress.set(0);
                    const nextIndex = Math.max(0, laps.findIndex((entry) => entry === lap));
                    setCurrentLapIndex(nextIndex);
                  }}
                  onChangeSpeed={(nextSpeed) => setSpeed(nextSpeed)}
                />
              }
            />
          </div>

        </div>
      </div>

      {storyPanel ? (
        <RaceStoryPanel 
          visualization={visualization} 
          currentLap={currentLap} 
          raceControl={activeRaceControl}
          trafficSummary={trafficSummary}
        />
      ) : null}
    </div>
  );
}
