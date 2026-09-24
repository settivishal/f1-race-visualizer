import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LapTimeChart, type LapTimeSeries } from "@/components/analysis/lap-time-chart";
import { PaceTable, type PaceRow } from "@/components/analysis/pace-table";
import { StrategyChart, type StrategyRow } from "@/components/analysis/strategy-chart";
import { HeadToHeadSection } from "./head-to-head-section";
import { getRaceAnalysis } from "@/lib/queries";

const FALLBACK_COLOR = "#8892a0";

/**
 * The Analysis tab.
 *
 * The narrowing done here is the same job `toReplayView` does for the replay:
 * the schema is honest that a driver row can be missing, and a chart has nothing
 * to draw for one, so those entries are dropped once at the boundary rather than
 * guarded in three components.
 *
 * Drivers are ordered by median pace, so the five the lap-time chart opens with
 * are the five that set the race's pace rather than the first five the database
 * returned.
 */
export async function AnalysisPanel({
  slug,
  searchParams,
}: {
  slug: string;
  /** Only the head-to-head reads it, inside its own boundary — see there. */
  searchParams: Promise<{ a?: string | string[]; b?: string | string[] }>;
}) {
  const { race } = await getRaceAnalysis(slug);
  if (!race) return null;

  const drivers = race.analysis.lapTimes
    .filter((entry) => entry.driver !== null)
    .map((entry) => ({
      id: entry.driver!.id,
      code: entry.driver!.code,
      name: entry.driver!.name,
      teamName: entry.team?.name ?? "—",
      color: entry.team?.color ?? FALLBACK_COLOR,
      laps: entry.laps,
      pace: entry.pace,
    }))
    .sort((a, b) => {
      if (a.pace.median === null) return b.pace.median === null ? 0 : 1;
      if (b.pace.median === null) return -1;
      return a.pace.median - b.pace.median;
    });

  const series: LapTimeSeries[] = drivers.map((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    color: d.color,
    laps: d.laps,
  }));

  const paceRows: PaceRow[] = drivers.map((d) => ({
    code: d.code,
    name: d.name,
    teamName: d.teamName,
    color: d.color,
    best: d.pace.best ?? null,
    median: d.pace.median ?? null,
    consistency: d.pace.consistency ?? null,
    lapsCounted: d.pace.lapsCounted,
    lapsExcluded: d.pace.lapsExcluded,
  }));

  // Laps the race was stopped on: several cars stationary for the same half
  // hour. One car alone is a retirement into the garage, which upstream files
  // the same way — it still does not count as a stop, but it is not a red flag
  // either, so it gets no marker.
  const stoppedCars = new Map<number, number>();
  for (const stop of race.analysis.pitStops) {
    if (stop.underStoppage) stoppedCars.set(stop.lap, (stoppedCars.get(stop.lap) ?? 0) + 1);
  }
  const stoppedOn = new Set(
    [...stoppedCars].filter(([, cars]) => cars >= 2).map(([lap]) => lap),
  );

  const strategyRows: StrategyRow[] = drivers
    .map((driver) => ({
      code: driver.code,
      name: driver.name,
      stints: race.analysis.stints
        .filter((stint) => stint.driver?.id === driver.id)
        .map((stint) => ({
          stintNumber: stint.stintNumber,
          lapStart: stint.lapStart,
          lapEnd: stint.lapEnd,
          compound: stint.compound ?? null,
        }))
        .sort((a, b) => a.stintNumber - b.stintNumber),
      // Split rather than filtered: a suspension is not a stop the driver
      // chose, but it is why their tyres changed, so the row has to show both.
      stops: race.analysis.pitStops
        .filter((stop) => stop.driver?.id === driver.id && !stop.underStoppage)
        .map((stop) => ({ lap: stop.lap, durationSeconds: stop.durationSeconds ?? null })),
      stoppageLaps: race.analysis.pitStops
        .filter((stop) => stop.driver?.id === driver.id && stoppedOn.has(stop.lap))
        .map((stop) => stop.lap),
    }))
    // A driver with no stint rows would draw an empty bar, which reads as a
    // rendering bug rather than as an absence of data.
    .filter((row) => row.stints.length > 0);

  return (
    <div className="space-y-12">
      <section className="reveal">
        <AnalysisHeading
          eyebrow="Pace"
          title="Lap times"
          description="Pit laps, their out-laps and anything more than 7% off a driver's own median are left out of the line — they say more about the strategy than the pace."
        />
        <div className="mt-5">
          <LapTimeChart series={series} />
        </div>
      </section>

      <section className="reveal">
        <AnalysisHeading
          eyebrow="Strategy"
          title="Tyres"
          description={
            race.dataTier === 'LAPS'
              ? 'Tyre compounds were not published for this era, so the stints below are the pit stops only.'
              : strategyRows.some((row) => row.stoppageLaps.length > 0)
                ? 'Every stint, sized by the laps it lasted. This race was stopped, and a tyre change under a red flag costs nothing — so it is marked rather than counted as a stop.'
                : 'Every stint, sized by the laps it lasted.'
          }
        />
        <div className="mt-5">
          {race.dataTier === 'LAPS' && strategyRows.length === 0 ? (
            <p className="text-sm text-muted">
              No tyre data exists for {race.meeting?.season ?? 'this season'} — the compound a
              car was on is not in the record before 2023. The pit stops are still counted in
              the lap-time chart above, where they break the line.
            </p>
          ) : (
            <StrategyChart rows={strategyRows} totalLaps={race.laps} />
          )}
        </div>
      </section>

      <section className="reveal">
        <AnalysisHeading
          eyebrow="Head to head"
          title="Two drivers, lap by lap"
          description="Who was in front, for how long, and what it cost in pace. Pick any two who started."
        />
        <div className="mt-5">
          {/* The one part of the tab that depends on the URL, so the one part
              that renders per request. Everything above and below it is
              prerendered with the page. */}
          <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
            <HeadToHeadSection slug={slug} searchParams={searchParams} />
          </Suspense>
        </div>
      </section>

      <section className="reveal">
        <AnalysisHeading
          eyebrow="Summary"
          title="Race pace"
          description="The median is the pace that decided the race; the fastest lap is the one everyone quotes."
        />
        <div className="mt-5">
          <PaceTable rows={paceRows} />
        </div>
      </section>
    </div>
  );
}

/**
 * `SectionHeader` renders an h1, and the page already has one — the race's name.
 * These are sections within it.
 */
function AnalysisHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-eyebrow font-bold uppercase text-accent">{eyebrow}</p>
      <h3 className="type-section-title mt-2">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
