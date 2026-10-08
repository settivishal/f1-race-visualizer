"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig, useMotionValue } from "framer-motion";
import { RaceVisualizationCanvas } from "./race-visualization-canvas";
import { GREEN_FLAG, buildRaceControlByLap } from "./replay-state";
import { buildStoryChapters } from "./story-chapters";
import type { ReplayView } from "./types";

/**
 * The race as a story you scroll: the chart holds still while chapters pass
 * under it, and the chapter in the middle of the screen sets the lap.
 *
 * Scrolling is the only input. Each chapter is a heading and a link to the
 * replay at its lap, so keyboard and screen-reader users get the same story as
 * a list; tabbing to a link scrolls its chapter into place, which moves the
 * chart with it. The chart jumps rather than tweens, so reduced motion needs
 * nothing of its own.
 */
export function RaceStory({ visualization, slug }: { visualization: ReplayView; slug: string }) {
  const chapters = useMemo(() => buildStoryChapters(visualization), [visualization]);
  const raceControlByLap = useMemo(
    () => buildRaceControlByLap(visualization.laps, visualization.events),
    [visualization.laps, visualization.events],
  );
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const lapProgress = useMotionValue(0);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLElement>("[data-chapter]");
    if (!items?.length) return;
    // A thin band two thirds down the viewport, below where the sticky chart
    // ends on a phone: whichever chapter is crossing it is the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.chapter));
        }
      },
      { rootMargin: "-65% 0px -30% 0px" },
    );
    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [chapters]);

  const chapter = chapters[active] ?? chapters[0];
  if (!chapter) return null;
  const lap = chapter.lap;

  return (
    <MotionConfig reducedMotion="user">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {/* The chart first in the markup so it pins above the chapters on a
            phone; on a desktop it moves to the right column. */}
        <div className="sticky top-14 z-10 -mx-4 bg-background px-4 pb-2 sm:top-16 lg:order-2 lg:mx-0 lg:self-start lg:bg-transparent lg:px-0 lg:top-20">
          <RaceVisualizationCanvas
            className="h-[50vh] p-3 lg:h-[calc(100vh-7rem)]"
            minimal
            visualization={visualization}
            currentLap={lap}
            nextLap={lap}
            lapProgress={lapProgress}
            raceControl={raceControlByLap.get(lap) ?? GREEN_FLAG}
            focusedDriverId={null}
            highlightedDriverId={hovered ?? chapter.driverId}
            onToggleDriver={() => {}}
            onHoverDriver={setHovered}
          />
        </div>

        <ol ref={list} className="lg:order-1 lg:py-[30vh]" aria-label="Race story">
          {chapters.map((entry, index) => (
            <li
              key={entry.id}
              data-chapter={index}
              className={`flex min-h-[60vh] flex-col justify-center border-l-2 py-10 pl-5 transition-colors ${
                index === active ? "border-accent" : "border-line"
              }`}
            >
              <p className="text-eyebrow font-semibold uppercase text-muted">Lap {entry.lap}</p>
              <h2 className="mt-1 font-heading text-2xl font-bold tracking-tight">{entry.title}</h2>
              {entry.lines.map((line) => (
                <p key={line} className="mt-2 text-sm text-muted">
                  {line}
                </p>
              ))}
              <Link
                href={`/races/${slug}?lap=${entry.lap}`}
                className="mt-4 self-start text-sm font-semibold text-accent hover:underline"
              >
                Open the replay at lap {entry.lap} →
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </MotionConfig>
  );
}
