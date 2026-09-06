import { Button } from "@/components/ui/button";
import { motion, MotionValue, useTransform } from "framer-motion";

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-white">
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
  compact = false,
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
  compact?: boolean;
}) {
  const percent = useTransform(lapProgress, (p) => {
    return Math.max(0, Math.min(100, ((currentLap - 1 + p) / Math.max(1, maxLap - 1)) * 100));
  });
  
  const widthStr = useTransform(percent, (p) => `${p}%`);
  const thumbStrCompact = useTransform(percent, (p) => `calc(${p}% - 7px)`);
  const thumbStrNormal = useTransform(percent, (p) => `calc(${p}% - 8px)`);

  if (compact) {
    return (
      <div className="min-w-[min(100%,34rem)] rounded-[1.6rem] border border-white/10 bg-[#07090c]/55 px-6 py-5 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!canStepBackward}
            aria-label="Previous lap"
            className="h-8 w-8 flex items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/15 disabled:opacity-30 transition"
          >
            <PrevIcon />
          </button>
          <button
            type="button"
            onClick={onPlayPause}
            aria-label={isPlaying ? "Pause replay" : "Play replay"}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-[#e10600] text-white hover:bg-[#ff0700] hover:shadow-[0_0_12px_rgba(225,6,0,0.5)] transition-all duration-200"
          >
            {isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!canStepForward}
            aria-label="Next lap"
            className="h-8 w-8 flex items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/15 disabled:opacity-30 transition"
          >
            <NextIcon />
          </button>
          <button
            type="button"
            onClick={onRestart}
            aria-label="Restart replay"
            className="h-8 w-8 flex items-center justify-center rounded-full border border-white/10 bg-white/5 text-white hover:bg-white/15 transition"
          >
            <RestartIcon />
          </button>

          <div className="ml-auto flex flex-wrap gap-1">
            {SPEED_OPTIONS.map((option) => {
              const isActive = option === speed;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChangeSpeed(option)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-all duration-200 ${
                    isActive
                      ? "bg-[#e10600] text-white shadow-md hover:bg-[#ff0700]"
                      : "border border-white/8 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {option}x
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3.5 grid gap-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
            <span>Lap {currentLap}</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          
          <div className="relative w-full h-1.5 mt-1">
            {/* The visual progress track */}
            <div className="absolute inset-0 h-full overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-[#e10600]"
                style={{ width: widthStr }}
              />
            </div>
            {/* The visible scrubber head (thumb) */}
            <motion.div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border border-[#e10600] shadow-[0_0_6px_rgba(225,6,0,0.8)] pointer-events-none"
              style={{ left: thumbStrCompact }}
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

  return (
    <div className="rounded-[2rem] border border-[color:var(--color-line)] bg-white/72 p-5 shadow-sm">
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={onPlayPause}
              className="bg-[#e10600] text-white hover:bg-[#ff0700] hover:shadow-[0_0_12px_rgba(225,6,0,0.4)]"
            >
              {isPlaying ? "Pause Replay" : "Play Replay"}
            </Button>
            <Button type="button" variant="secondary" onClick={onRestart}>
              Restart
            </Button>
            <Button type="button" variant="secondary" onClick={onPrevious} disabled={!canStepBackward}>
              Previous Lap
            </Button>
            <Button type="button" variant="secondary" onClick={onNext} disabled={!canStepForward}>
              Next Lap
            </Button>
          </div>

          <div>
            <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-muted)]">
              <span>Lap scrubber</span>
              <span>
                Lap {currentLap} / {maxLap}
              </span>
            </div>
            
            <div className="relative w-full h-2 mt-3">
              {/* The visual progress track */}
              <div className="absolute inset-0 h-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
                <motion.div
                  className="h-full rounded-full bg-[#e10600]"
                  style={{ width: widthStr }}
                />
              </div>
              {/* The visible scrubber head (thumb) */}
              <motion.div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white border border-[#e10600] shadow-[0_0_6px_rgba(225,6,0,0.8)] pointer-events-none"
                style={{ left: thumbStrNormal }}
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
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-foreground">
              Playback speed
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onChangeSpeed(option)}
                  className={
                    option === speed
                      ? "rounded-full bg-[#e10600] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
                      : "rounded-full border border-line bg-panel px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-foreground hover:bg-panel-strong transition-colors"
                  }
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-3">
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
                Current lap
              </p>
              <p className="mt-2 font-heading text-3xl leading-none text-foreground">
                {currentLap}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
                Progress
              </p>
              <p className="mt-2 font-heading text-3xl leading-none text-foreground">
                {Math.round(progressPercent)}%
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
                Speed
              </p>
              <p className="mt-2 font-heading text-3xl leading-none text-foreground">
                {speed}x
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
