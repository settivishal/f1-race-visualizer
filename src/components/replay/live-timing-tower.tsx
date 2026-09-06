"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReplayView } from "./types";

interface TimingTowerProps {
  visualization: ReplayView;
  currentLap: number;
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

export function LiveTimingTower({ visualization, currentLap }: TimingTowerProps) {
  const standings = useMemo(() => {
    const currentStandings = [];

    // Precompute overall bests up to currentLap
    let overallBestS1: number | null = null;
    let overallBestS2: number | null = null;
    let overallBestS3: number | null = null;

    for (const entry of visualization.drivers) {
      for (const pos of entry.positions) {
        if (pos.lap > currentLap) break;
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
        if (pos.lap > currentLap) break;
        currentPos = pos;
        
        if (pos.sector1 != null && (personalBestS1 == null || pos.sector1 < personalBestS1)) personalBestS1 = pos.sector1;
        if (pos.sector2 != null && (personalBestS2 == null || pos.sector2 < personalBestS2)) personalBestS2 = pos.sector2;
        if (pos.sector3 != null && (personalBestS3 == null || pos.sector3 < personalBestS3)) personalBestS3 = pos.sector3;
      }

      if (currentPos && currentPos.lap <= currentLap) {
        currentStandings.push({
          entry,
          position: currentPos.position,
          gap: currentPos.gap,
          sector1: currentPos.sector1,
          sector2: currentPos.sector2,
          sector3: currentPos.sector3,
          lapTime: currentPos.lapTime,
          s1Color: getSectorColor(currentPos.sector1, personalBestS1, overallBestS1),
          s2Color: getSectorColor(currentPos.sector2, personalBestS2, overallBestS2),
          s3Color: getSectorColor(currentPos.sector3, personalBestS3, overallBestS3),
        });
      }
    }

    return currentStandings.sort((a, b) => a.position - b.position);
  }, [visualization.drivers, currentLap]);

  return (
    <div
      id={TIMING_TOWER_ID}
      className="flex flex-col h-full bg-panel shadow-sm ring-1 ring-line rounded-[2rem] overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-line bg-panel-strong/50">
        <h3 className="font-semibold text-sm text-foreground tracking-tight">Live Timing</h3>
        <p className="text-xs text-muted">Lap {currentLap} / {visualization.summary.maxLap || visualization.race.laps}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 hide-scrollbar">
        <div className="flex text-[10px] uppercase font-semibold text-muted mb-2 px-2">
          <div className="w-6">Pos</div>
          <div className="flex-1">Driver</div>
          <div className="w-12 text-right">Gap</div>
          <div className="w-10 text-right ml-2">S1</div>
          <div className="w-10 text-right">S2</div>
          <div className="w-10 text-right">S3</div>
        </div>
        
        <div className="relative">
          <AnimatePresence initial={false}>
            {standings.map((standing) => (
              <motion.div
                key={standing.entry.driver.id}
                layout="position"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="flex items-center text-xs py-1.5 px-2 rounded-md hover:bg-black/5 dark:hover:bg-white/5 group"
              >
                <div className="w-6 font-mono font-medium text-muted">
                  {standing.position}
                </div>
                <div className="flex-1 flex items-center gap-2 overflow-hidden">
                  <div 
                    className="w-1 h-3 rounded-full shrink-0" 
                    style={{ backgroundColor: standing.entry.team.color }} 
                  />
                  <span className="font-semibold text-foreground truncate">{standing.entry.driver.code}</span>
                </div>
                <div className="w-12 text-right font-mono text-[11px] text-muted truncate">
                  {standing.gap === "LEADER" ? "Lap" : standing.gap}
                </div>
                
                {/* Mini-Sectors */}
                <SectorBlock value={standing.sector1} color={standing.s1Color} className="ml-2" />
                <SectorBlock value={standing.sector2} color={standing.s2Color} />
                <SectorBlock value={standing.sector3} color={standing.s3Color} />
              </motion.div>
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
    colorClass = "text-purple-600 dark:text-purple-400 font-bold";
  } else if (color === "green") {
    colorClass = "text-emerald-600 dark:text-emerald-400 font-bold";
  } else if (color === "yellow") {
    colorClass = "text-amber-600 dark:text-amber-400";
  }

  return (
    <div className={`w-10 text-right font-mono text-[10px] ${colorClass} ${className}`}>
      {formatSector(value)}
    </div>
  );
}
