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
 * One speed option. Hoisted out of the component: defined inside it, this would
 * be a new component type on every render, and React would unmount and remount
 * the buttons rather than update them.
 */
function SpeedButton({
  option,
  isActive,
  onSelect,
  className = "",
}: {
  option: number;
  isActive: boolean;
  onSelect: (speed: number) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option)}
      className={`tap inline-flex h-9 items-center justify-center rounded-md px-2.5 text-eyebrow font-bold uppercase transition ${className} ${
        isActive
          ? "bg-accent-fill text-on-accent hover:bg-accent-strong"
          : "border border-white/15 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white"
      }`}
    >
      {option}x
    </button>
  );
}

export function ReplayControls({
  currentLap,
  maxLap,
  isPlaying,
  speed,
  progressPercent,
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
  progressPercent: number;
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

  // These controls render inside the chart panel, which stays dark in
  // both themes (see docs/decisions.md, "The chart panel stays dark in both
  // themes"). So its surfaces are fixed dark values, not theme tokens — with
  // tokens it turned into white buttons on a black chart in light mode. Only
  // the accent is a token, because it is red either way.
  return (
    <div className="w-full rounded-xl border border-white/10 bg-black/55 px-4 py-4 shadow-lg backdrop-blur-md sm:px-6 sm:py-5">
      {/* Two deliberate rows rather than one that wraps: at 390px the four
          transport buttons and five speeds cannot share a line, and letting
          them wrap put a lone 8x on a third row of its own. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!canStepBackward}
          aria-label="Previous lap"
          className="tap-square h-9 w-9 flex items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          onClick={onPlayPause}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
          // The same button as its three neighbours. It used to be a red
          // disc, which made one control in a row of four read as a
          // different kind of thing; the accent is carried by the speed
          // selection and the progress bar, which is enough red for one
          // panel.
          className="tap-square h-9 w-9 flex items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20 active:brightness-90"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canStepForward}
          aria-label="Next lap"
          className="tap-square h-9 w-9 flex items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-30"
        >
          <NextIcon />
        </button>
        <button
          type="button"
          onClick={onRestart}
          aria-label="Restart replay"
          className="tap-square h-9 w-9 flex items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition hover:bg-white/20"
        >
          <RestartIcon />
        </button>

        {/* A segmented control on its own line: five options that share the
            width rather than five pills that wrap. */}
        <div className="ml-auto hidden gap-1 sm:flex">
          {SPEED_OPTIONS.map((option) => (
            <SpeedButton
              key={option}
              option={option}
              isActive={option === speed}
              onSelect={onChangeSpeed}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex gap-1 sm:hidden">
        {SPEED_OPTIONS.map((option) => (
          <SpeedButton
            key={option}
            option={option}
            isActive={option === speed}
            onSelect={onChangeSpeed}
            className="flex-1"
          />
        ))}
      </div>

      <div className="mt-3.5 grid gap-2">
        <div className="flex items-center justify-between text-eyebrow font-bold uppercase text-white/60">
          <span>Lap {currentLap}</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        
        <div className="relative w-full h-1.5 mt-1">
          {/* The visual progress track */}
          <div className="absolute inset-0 h-full overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full rounded-full bg-accent"
              style={{ width: widthStr }}
            />
          </div>
          {/* The visible scrubber head (thumb) */}
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-foreground border-2 border-accent pointer-events-none"
            style={{ left: thumbStr }}
          />
          {/* The invisible interactive range slider on top */}
          <input
            type="range"
            min={1}
            max={Math.max(1, maxLap)}
            step={1}
            value={Math.max(1, currentLap)}
            onChange={(event) => onJumpToLap(Number(event.target.value))}
            className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
            aria-label="Lap scrubber"
          />
        </div>
      </div>
    </div>
  );
}
