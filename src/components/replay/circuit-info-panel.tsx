"use client";

import { Card } from "@/components/ui/card";
import { getCircuitData } from "@/lib/circuit-data";
import Image from "next/image";

type CircuitInfoPanelProps = {
  circuitName: string | null;
  country: string | null;
  raceName: string | null;
  weather?: unknown | null; // Kept for backwards compatibility
};

export function CircuitInfoPanel({
  circuitName,
  country,
  raceName,
}: CircuitInfoPanelProps) {
  const circuitData = getCircuitData(circuitName, country, raceName);

  // Split lap record into time and driver (if format is "time (driver, year)")
  const lapRecordParts = circuitData.lapRecord.split(" (");
  const lapRecordTime = lapRecordParts[0];
  const lapRecordDriver = lapRecordParts.length > 1 ? lapRecordParts[1].replace(")", "") : "";

  return (
    <Card className="mt-8 mb-4 p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-foreground mb-2">
            Circuit Profile
          </p>
          <p className="text-xl font-bold text-muted">{circuitData.name}</p>
        </div>
      </div>

      <div className="grid gap-12 lg:grid-cols-[1.8fr_1fr] items-center">
        {/* Left: Circuit Map */}
        <div className="w-full flex items-center justify-center p-6 bg-panel/50 rounded-2xl border border-line">
          <Image 
            src={circuitData.imageUrl} 
            alt={`${circuitData.name} layout`}
            width={800}
            height={600}
            className="w-full h-auto max-w-3xl object-contain drop-shadow-md"
          />
        </div>
        
        {/* Right: Circuit Statistics */}
        <div className="flex flex-col text-foreground">
          <div className="pb-5 border-b border-line">
            <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">Circuit Length</p>
            <p className="text-3xl font-heading tracking-wide">
              {circuitData.lengthKM.toFixed(3)}km
            </p>
          </div>

          <div className="py-5 border-b border-line grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">Turns</p>
              <p className="text-xl font-heading tracking-wide">
                {circuitData.turns}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">Laps</p>
              <p className="text-xl font-heading tracking-wide">
                {circuitData.laps ?? 50}
              </p>
            </div>
          </div>

          <div className="py-5 border-b border-line grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">First Grand Prix</p>
              <p className="text-xl font-heading tracking-wide">
                {circuitData.firstGrandPrix ?? 1950}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">Race Distance</p>
              <p className="text-xl font-heading tracking-wide">
                {circuitData.raceDistance 
                  ? circuitData.raceDistance.toFixed(3) 
                  : ((circuitData.laps ?? 50) * circuitData.lengthKM).toFixed(3)}km
              </p>
            </div>
          </div>

          <div className="pt-5">
            <p className="text-[11px] text-muted mb-1 uppercase tracking-wider">Fastest lap</p>
            <p className="text-xl font-heading tracking-wide mb-0.5">
              {lapRecordTime}
            </p>
            {lapRecordDriver && (
              <p className="text-[11px] text-muted">
                {lapRecordDriver}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
