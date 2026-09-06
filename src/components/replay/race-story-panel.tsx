"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ReplayView } from "./types";
import { getRaceControlTone, ReplayRaceControl } from "./replay-state";

type StoryMoment = {
  id: string;
  lap: number;
  title: string;
  description: string;
  tone: "event" | "overtake" | "strategy";
};

const STORY_FILTERS = [
  { id: "all", label: "All moments" },
  { id: "event", label: "Race control" },
  { id: "strategy", label: "Strategy" },
  { id: "overtake", label: "Position swings" },
] as const;

type StoryFilterId = (typeof STORY_FILTERS)[number]["id"];

function buildStoryMoments(visualization: ReplayView) {
  const eventMoments: StoryMoment[] = visualization.events.map((event, index) => ({
    // v1 keyed on an event id the schema does not expose. Lap, type and
    // ordinal identify a row just as well and need no new field.
    id: `event-${event.lap}-${event.type}-${index}`,
    lap: event.lap,
    title: `${event.type} on lap ${event.lap}`,
    description: event.driver
      ? `${event.driver.code} #${event.driver.number}: ${event.details}`
      : event.details,
    tone: event.type.toLowerCase().includes("pit") ? "strategy" : "event",
  }));

  const overtakeMoments: StoryMoment[] = [];

  for (const entry of visualization.drivers) {
    for (let index = 1; index < entry.positions.length; index += 1) {
      const previous = entry.positions[index - 1];
      const current = entry.positions[index];
      if (!previous || !current) {
        continue;
      }

      const gainedPlaces = previous.position - current.position;
      if (gainedPlaces >= 2) {
        overtakeMoments.push({
          id: `gain-${entry.driver.id}-${current.lap}`,
          lap: current.lap,
          title: `${entry.driver.code} charges forward`,
          description: `${entry.driver.name} gains ${gainedPlaces} places by lap ${current.lap}, moving from P${previous.position} to P${current.position}.`,
          tone: "overtake",
        });
      }
    }
  }

  return [...eventMoments, ...overtakeMoments]
    .sort((left, right) => left.lap - right.lap || left.title.localeCompare(right.title))
    .filter((moment, index, moments) => {
      if (index === 0) {
        return true;
      }

      const previous = moments[index - 1];
      return !previous || previous.title !== moment.title || previous.lap !== moment.lap;
    });
}

function getStoryToneClasses(tone: StoryMoment["tone"], isActive: boolean) {
  if (tone === "strategy") {
    return isActive
      ? "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-500/30 dark:bg-sky-950/20 dark:text-sky-200"
      : "border-line bg-panel text-foreground";
  }

  if (tone === "overtake") {
    return isActive
      ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-950/20 dark:text-emerald-200"
      : "border-line bg-panel text-foreground";
  }

  return isActive
    ? "border-accent/40 bg-accent-soft text-foreground"
    : "border-line bg-panel text-foreground";
}

export function RaceStoryPanel({
  visualization,
  currentLap,
  raceControl,
  trafficSummary,
}: {
  visualization: ReplayView;
  currentLap: number;
  raceControl: ReplayRaceControl;
  trafficSummary: {
    lappedCount: number;
    backmarkerCount: number;
    retiredCount: number;
  };
}) {
  const storyMoments = useMemo(() => buildStoryMoments(visualization), [visualization]);
  const [selectedFilter, setSelectedFilter] = useState<StoryFilterId>("all");
  const activeMoment =
    [...storyMoments].reverse().find((moment) => moment.lap <= currentLap) ?? storyMoments[0] ?? null;
  const filteredMoments = useMemo(() => {
    if (selectedFilter === "all") {
      return storyMoments;
    }

    return storyMoments.filter((moment) => moment.tone === selectedFilter);
  }, [selectedFilter, storyMoments]);
  const visibleActiveMoment =
    filteredMoments.find((moment) => moment.id === activeMoment?.id) ?? filteredMoments[0] ?? null;

  return (
    <Card>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-foreground">
            Race Story
          </p>
          <h3 className="mt-3 font-heading text-3xl leading-none text-foreground">
            Replay context that moves with the race.
          </h3>
          <p className="mt-3 text-sm leading-7 text-muted">
            Commentary highlights turn raw lap progression into a narrative, helping users spot
            strategy shifts, race-control moments, and the biggest momentum swings.
          </p>
        </div>
        <Badge>
          {visibleActiveMoment ? `Active story • Lap ${visibleActiveMoment.lap}` : `Lap ${currentLap}`}
        </Badge>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="flex flex-col gap-4 rounded-[1.6rem] border border-line bg-panel p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              Race control
            </p>
            <div className="mt-3 flex items-center gap-2">
              <div
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${getRaceControlTone(raceControl.status)}`}
              >
                {raceControl.label}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              {raceControl.details ?? "No caution or control change is recorded for this lap range."}
            </p>
          </div>

          <hr className="border-line" />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Lapped</p>
              <p className="mt-1 text-xl font-heading text-foreground">{trafficSummary.lappedCount}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Tail Traffic</p>
              <p className="mt-1 text-xl font-heading text-foreground">{trafficSummary.backmarkerCount}</p>
            </div>
          </div>

          {trafficSummary.retiredCount > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-200">
              {trafficSummary.retiredCount} driver{trafficSummary.retiredCount === 1 ? "" : "s"} retired
            </div>
          ) : null}

          <hr className="border-line" />

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              Current focus
            </p>
            {visibleActiveMoment ? (
              <>
                <p className="mt-2 text-lg font-bold leading-6 text-foreground">
                  {visibleActiveMoment.title}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {visibleActiveMoment.description}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted">
                No major story beats have been derived from this replay yet.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              Story chapters
            </p>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
              {filteredMoments.length} highlight{filteredMoments.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {STORY_FILTERS.map((filter) => {
              const isActive = filter.id === selectedFilter;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setSelectedFilter(filter.id)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    isActive
                      ? "border-transparent bg-[#e10600] text-white shadow-sm"
                      : "border-line bg-panel text-foreground hover:bg-panel-strong"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div className="grid max-h-[30rem] gap-3 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-1">
            {filteredMoments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-panel/50 px-4 py-5 text-sm text-muted md:col-span-2 xl:col-span-1">
                Story moments will appear here once replay events or notable position swings are available.
              </div>
            ) : (
              filteredMoments.map((moment) => {
                const isActive = moment.id === visibleActiveMoment?.id;
                return (
                  <div
                    key={moment.id}
                    className={`rounded-2xl border px-4 py-4 transition ${getStoryToneClasses(moment.tone, isActive)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.22em] text-foreground">
                        Lap {moment.lap}
                      </p>
                      {isActive ? (
                        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
                          Live
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm font-bold leading-6 text-foreground">
                      {moment.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      {moment.description}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
