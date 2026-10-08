import { motion, MotionValue, useTransform } from "framer-motion";

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const PrevIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const NextIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const RestartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
    <path d="M21.5 2v6h-6" />
    <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
  </svg>
);

/**
 * One segment of the speed control. Hoisted out of the component: defined
 * inside it, this would be a new component type on every render, and React
 * would unmount and remount the buttons rather than update them.
 */
function SpeedButton({
  option,
  isActive,
  onSelect,
}: {
  option: number;
  isActive: boolean;
  onSelect: (speed: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => onSelect(option)}
      className={`tap inline-flex h-8 min-w-7 items-center justify-center rounded-md px-1 sm:min-w-9 sm:px-2 text-eyebrow font-bold uppercase transition ${
        isActive
          ? "bg-accent-fill text-on-accent hover:bg-accent-strong"
          : "text-white/65 hover:bg-white/10 hover:text-white"
      }`}
    >
      {option}x
    </button>
  );
}

const transportClasses =
  "tap-square flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30";

export function ReplayControls({
  currentLap,
  maxLap,
  isPlaying,
  speed,
  lapProgress,
  canStepBackward,
  canStepForward,
  onPlayPause,
  onRestart,
  onPrevious,
  onNext,
  onJumpToLap,
  onChangeSpeed,
}: {
  currentLap: number;
  maxLap: number;
  isPlaying: boolean;
  speed: number;
  lapProgress: MotionValue<number>;
  canStepBackward: boolean;
  canStepForward: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onJumpToLap: (lap: number) => void;
  onChangeSpeed: (speed: number) => void;
}) {
  const percent = useTransform(lapProgress, (p) => {
    return Math.max(0, Math.min(100, ((currentLap - 1 + p) / Math.max(1, maxLap - 1)) * 100));
  });

  const widthStr = useTransform(percent, (p) => `${p}%`);
  const thumbStr = useTransform(percent, (p) => `calc(${p}% - 7px)`);

  // A dock that floats over the page, so its surfaces are fixed dark values in
  // both themes, like the chart panel it controls (docs/decisions.md, "The
  // chart panel stays dark in both themes"). Only the accent is a token.
  //
  // One row on a desktop: transport, scrubber, speed. On a phone the scrubber
  // drops to a second row of its own (order-last + w-full) rather than
  // squeezing between nine buttons.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2.5 rounded-2xl border border-white/10 bg-black/80 px-2.5 py-2.5 sm:gap-x-4 text-white shadow-2xl backdrop-blur-md sm:flex-nowrap sm:px-4">
      <div className="flex items-center gap-1 sm:gap-1.5">
        <button type="button" onClick={onPrevious} disabled={!canStepBackward} aria-label="Previous lap" className={transportClasses}>
          <PrevIcon />
        </button>
        <button type="button" onClick={onPlayPause} aria-label={isPlaying ? "Pause replay" : "Play replay"} className={transportClasses}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" onClick={onNext} disabled={!canStepForward} aria-label="Next lap" className={transportClasses}>
          <NextIcon />
        </button>
        <button type="button" onClick={onRestart} aria-label="Restart replay" className={transportClasses}>
          <RestartIcon />
        </button>
      </div>

      <div className="order-last flex w-full min-w-0 items-center gap-3 sm:order-none sm:w-auto sm:flex-1">
        <span className="tabular shrink-0 text-eyebrow font-bold uppercase text-white/70">
          Lap {currentLap}/{maxLap}
        </span>
        <div className="relative h-1.5 w-full">
          <div className="absolute inset-0 h-full overflow-hidden rounded-full bg-white/15">
            <motion.div className="h-full rounded-full bg-accent" style={{ width: widthStr }} />
          </div>
          <motion.div
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-accent bg-white"
            style={{ left: thumbStr }}
          />
          {/* The invisible native range on top: keyboard and screen reader
              support for free, drawn by the two layers under it. */}
          <input
            type="range"
            min={1}
            max={Math.max(1, maxLap)}
            step={1}
            value={Math.max(1, currentLap)}
            onChange={(event) => onJumpToLap(Number(event.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Lap scrubber"
          />
        </div>
      </div>

      <div role="group" aria-label="Replay speed" className="ml-auto flex rounded-[10px] border border-white/15 bg-white/5 p-[3px] sm:ml-0">
        {SPEED_OPTIONS.map((option) => (
          <SpeedButton key={option} option={option} isActive={option === speed} onSelect={onChangeSpeed} />
        ))}
      </div>
    </div>
  );
}
