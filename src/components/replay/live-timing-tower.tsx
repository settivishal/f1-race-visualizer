"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence, MotionValue, useMotionValueEvent } from "framer-motion";
import { cn } from "@/lib/cn";
import { formatLapTime } from "@/lib/scale";
import { compareTowerRows, getRetirementLapByDriver } from "./replay-state";
import type { ReplayView } from "./types";

interface TimingTowerProps {
  visualization: ReplayView;
  currentLap: number;
  /** The lap the chart is sliding towards; equal to `currentLap` on the last. */
  nextLap: number;
  /** How far through that slide the chart is, 0 to 1. */
  lapProgress: MotionValue<number>;
  /** The driver held by a click — what `aria-pressed` reports. */
  focusedDriverId: string | null;
  /** The driver drawn at full strength: the hovered one, else the clicked one. */
  highlightedDriverId: string | null;
  onToggleDriver: (driverId: string) => void;
  onHoverDriver: (driverId: string | null) => void;
}

type SectorColor = "purple" | "green" | "yellow" | "none";

function getSectorColor(
  currentVal: number | null | undefined,
  personalBest: number | null,
  overallBest: number | null
): SectorColor {
  if (currentVal == null) return "none";
  if (overallBest != null && currentVal <= overallBest) return "purple";
  if (personalBest != null && currentVal <= personalBest) return "green";
  return "yellow";
}

function formatSector(val: number | null | undefined): string {
  if (val == null) return "-";
  return val.toFixed(3);
}



/**
 * The chart is an SVG: `role="img"` with a label describes it but cannot convey
 * it. This tower renders the same running order as text, so it is what the
 * chart points at with aria-describedby — which is only meaningful because it
 * is a real, reachable part of the page rather than visually-hidden filler.
 */
export const TIMING_TOWER_ID = 'replay-timing-tower';

export function LiveTimingTower({
  visualization,
  currentLap,
  nextLap,
  lapProgress,
  focusedDriverId,
  highlightedDriverId,
  onToggleDriver,
  onHoverDriver,
}: TimingTowerProps) {
  // A fact about the era, not about this import — see races.data_tier.
  //
  // There is no gap column. `gap` is null on every row of every race: neither
  // upstream publishes a per-lap gap (transform.ts, ergast-transform.ts), so
  // the column rendered a header over nothing for four seasons.
  const hasTimingDetail = visualization.race.dataTier === 'FULL';

  // The order the chart is closest to, not the one it left.
  //
  // The chart spends the whole lap sliding from `currentLap` to `nextLap`, so a
  // tower pinned to `currentLap` is up to a full lap behind by the end of the
  // slide, and then snaps to the new order after the cars have already got
  // there — the reorder reads as a delayed echo rather than the same event.
  // This tower is the chart's `aria-describedby`, so it should round the way
  // the eye does: past the halfway point, the cars are nearer the next order
  // than the one they started from, and so is this list.
  //
  // Halfway is exactly where the eased position curve crosses, so the rows
  // start moving on the frame the cars cross.
  //
  // A `useState` rather than a derived MotionValue because the order is React
  // state that the layout spring animates; it changes once per lap, not once
  // per frame. Under a reduced-motion preference `lapProgress` never leaves 0,
  // so this stays false and the tower steps lap to lap as it always did.
  const [leadsNextLap, setLeadsNextLap] = useState(false);
  useMotionValueEvent(lapProgress, "change", (progress) => {
    setLeadsNextLap(progress >= 0.5);
  });
  const standingsLap = leadsNextLap ? nextLap : currentLap;

  const retirementByDriver = useMemo(
    () => getRetirementLapByDriver(visualization.events, visualization.drivers),
    [visualization.events, visualization.drivers],
  );

  const standings = useMemo(() => {
    const currentStandings = [];

    // Precompute overall bests up to standingsLap
    let overallBestS1: number | null = null;
    let overallBestS2: number | null = null;
    let overallBestS3: number | null = null;

    for (const entry of visualization.drivers) {
      for (const pos of entry.positions) {
        if (pos.lap > standingsLap) break;
        if (pos.sector1 != null && (overallBestS1 == null || pos.sector1 < overallBestS1)) overallBestS1 = pos.sector1;
        if (pos.sector2 != null && (overallBestS2 == null || pos.sector2 < overallBestS2)) overallBestS2 = pos.sector2;
        if (pos.sector3 != null && (overallBestS3 == null || pos.sector3 < overallBestS3)) overallBestS3 = pos.sector3;
      }
    }

    for (const entry of visualization.drivers) {
      // Find the position entry for the current lap (or the latest available lap before it)
      let currentPos = entry.positions[0];
      let personalBestS1: number | null = null;
      let personalBestS2: number | null = null;
      let personalBestS3: number | null = null;

      for (const pos of entry.positions) {
        if (pos.lap > standingsLap) break;
        currentPos = pos;
        
        if (pos.sector1 != null && (personalBestS1 == null || pos.sector1 < personalBestS1)) personalBestS1 = pos.sector1;
        if (pos.sector2 != null && (personalBestS2 == null || pos.sector2 < personalBestS2)) personalBestS2 = pos.sector2;
        if (pos.sector3 != null && (personalBestS3 == null || pos.sector3 < personalBestS3)) personalBestS3 = pos.sector3;
      }

      if (currentPos && currentPos.lap <= standingsLap) {
        // From the lap the chart marks the car out, the same test as there.
        // Its timing is blanked too: the last lap it set is not this lap's.
        const retirementLap = retirementByDriver.get(entry.driver.id)?.lap ?? null;
        const retiredLap = retirementLap !== null && standingsLap >= retirementLap ? retirementLap : null;
        const timing = retiredLap === null ? currentPos : { sector1: null, sector2: null, sector3: null, lapTime: null };
        currentStandings.push({
          entry,
          position: currentPos.position,
          retiredLap,
          sector1: timing.sector1,
          sector2: timing.sector2,
          sector3: timing.sector3,
          lapTime: timing.lapTime,
          s1Color: getSectorColor(timing.sector1, personalBestS1, overallBestS1),
          s2Color: getSectorColor(timing.sector2, personalBestS2, overallBestS2),
          s3Color: getSectorColor(timing.sector3, personalBestS3, overallBestS3),
        });
      }
    }

    return currentStandings.sort(compareTowerRows);
  }, [visualization.drivers, retirementByDriver, standingsLap]);

  return (
    <div
      id={TIMING_TOWER_ID}
      className="flex flex-col h-full overflow-hidden rounded-xl bg-panel shadow-sm ring-1 ring-line"
    >
      <div className="px-5 py-4 border-b border-line bg-panel-strong/50">
        <h3 className="font-semibold text-sm text-foreground tracking-tight">Live Timing</h3>
        <p className="text-xs text-muted">Lap {currentLap} / {visualization.summary.maxLap || visualization.race.laps}</p>
      </div>

      {hasTimingDetail ? null : (
        <p className="border-b border-line bg-panel-strong/30 px-5 py-2 text-[11px] leading-relaxed text-muted">
          Sector times were not published for {visualization.race.season}. Positions and lap
          times are the whole record for this era.
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2 hide-scrollbar">
        <div className="flex gap-1 text-eyebrow uppercase font-semibold text-muted mb-2 px-2">
          <div className="w-8">Pos</div>
          <div className="flex-1">Driver</div>
          <div className="w-14 text-right">Lap</div>
          {hasTimingDetail ? (
            <>
              <div className="w-10 text-right">S1</div>
              <div className="w-10 text-right">S2</div>
              <div className="w-10 text-right">S3</div>
            </>
          ) : null}
        </div>
        
        <div className="relative">
          <AnimatePresence initial={false}>
            {standings.map((standing) => (
              // A button, because the row is how you focus a driver on the
              // chart beside it — and the tower is what the chart points at
              // with aria-describedby, so the control and the text
              // alternative stay in the same place.
              <motion.button
                key={standing.entry.driver.id}
                type="button"
                aria-pressed={focusedDriverId === standing.entry.driver.id}
                onClick={() => onToggleDriver(standing.entry.driver.id)}
                // Focus as well as hover, so tabbing through the tower
                // previews each driver the way a pointer does.
                onMouseEnter={() => onHoverDriver(standing.entry.driver.id)}
                onMouseLeave={() => onHoverDriver(null)}
                onFocus={() => onHoverDriver(standing.entry.driver.id)}
                onBlur={() => onHoverDriver(null)}
                layout="position"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={cn(
                  "group flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs transition-[background-color,opacity] duration-200 hover:bg-panel-strong",
                  highlightedDriverId === standing.entry.driver.id
                    ? "bg-panel-strong ring-1 ring-line-strong"
                    : highlightedDriverId || standing.retiredLap !== null
                      ? "opacity-60"
                      : null,
                )}
              >
                <div className="tabular w-8 font-mono font-medium text-muted">
                  {standing.retiredLap === null ? standing.position : "OUT"}
                </div>
                <div className="flex-1 flex items-center gap-2 overflow-hidden">
                  <div 
                    className="w-1 h-3 rounded-full shrink-0" 
                    style={{ backgroundColor: standing.entry.team.color }} 
                  />
                  {/* The one hook the smoke test holds onto: the tower's
                      order is the assertion that a replay actually replays,
                      and every other selector here is a styling class. */}
                  <span data-testid="tower-driver" className="font-semibold text-foreground truncate">{standing.entry.driver.code}</span>
                </div>
                {/* The lap time has been ingested since M1 and displayed
                    nowhere. It is the number the sectors add up to, so it
                    belongs beside them. */}
                <div className="tabular w-14 text-right font-mono text-[11px] text-foreground">
                  {standing.lapTime == null ? "—" : formatLapTime(standing.lapTime)}
                </div>

                {/* Mini-sectors, where the era published them. Columns of
                    dashes read as broken data rather than as an absence, so a
                    LAPS-tier race drops them and says why below. */}
                {hasTimingDetail ? (
                  <>
                    <SectorBlock value={standing.sector1} color={standing.s1Color} />
                    <SectorBlock value={standing.sector2} color={standing.s2Color} />
                    <SectorBlock value={standing.sector3} color={standing.s3Color} />
                  </>
                ) : null}
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function SectorBlock({ value, color, className = "" }: { value: number | null | undefined, color: SectorColor, className?: string }) {
  let colorClass = "text-muted";
  
  if (color === "purple") {
    colorClass = "text-timing-best font-bold";
  } else if (color === "green") {
    colorClass = "text-timing-personal font-bold";
  } else if (color === "yellow") {
    colorClass = "text-timing-slower";
  }

  return (
    <div className={`tabular w-10 text-right font-mono text-[10px] ${colorClass} ${className}`}>
      {formatSector(value)}
    </div>
  );
}
