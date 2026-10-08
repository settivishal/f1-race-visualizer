import { buildStoryMoments, significanceOf, type StoryMoment } from "./story-moments";
import type { ReplayView } from "./types";

/**
 * The race told in a dozen stops, for the scroll story.
 *
 * The timeline under the player shows every key moment; a story cannot. Pit
 * stops are left out (a normal race has forty of them, and they are a strategy
 * question rather than a plot point), the rest are grouped by lap so a safety
 * car and the crash behind it are one chapter, and a busy race keeps its
 * biggest moments. Pure, so the choice can be tested without rendering.
 */

export type StoryChapter = {
  id: string;
  lap: number;
  title: string;
  /** One line per moment on the lap. */
  lines: string[];
  /** Who the chart should pick out, if the chapter is about one driver. */
  driverId: string | null;
};

export const MAX_CHAPTERS = 12;

// Lower is more important. Unlisted kinds (penalties, fastest lap, yellow
// flags) fill whatever room is left.
const RANK: Partial<Record<StoryMoment["eventKind"], number>> = {
  "red-flag": 0,
  "safety-car": 1,
  "virtual-safety-car": 2,
  dnf: 3,
  dsq: 3,
  overtake: 4,
};

const rankOf = (moments: StoryMoment[]) =>
  Math.min(...moments.map((moment) => RANK[moment.eventKind] ?? 5));

const placesOf = (moments: StoryMoment[]) =>
  Math.max(0, ...moments.map((moment) => moment.places ?? 0));

/** Who led on a lap, from the recorded order. */
function leaderOn(visualization: ReplayView, lap: number) {
  return (
    visualization.drivers.find((entry) =>
      entry.positions.some((row) => row.lap === lap && row.position === 1),
    ) ?? null
  );
}

export function buildStoryChapters(visualization: ReplayView): StoryChapter[] {
  const { laps } = visualization;
  if (laps.length === 0) return [];
  const first = laps[0];
  const last = laps[laps.length - 1];

  const byLap = new Map<number, StoryMoment[]>();
  for (const moment of buildStoryMoments(visualization)) {
    if (moment.kind === "strategy" || significanceOf(moment) !== "major") continue;
    // The first and last laps are their own chapters below.
    if (moment.lap <= first || moment.lap >= last) continue;
    byLap.set(moment.lap, [...(byLap.get(moment.lap) ?? []), moment]);
  }

  const middle = [...byLap.entries()]
    .sort(([, a], [, b]) => rankOf(a) - rankOf(b) || placesOf(b) - placesOf(a))
    .slice(0, MAX_CHAPTERS - 2)
    .sort(([a], [b]) => a - b)
    .map(([lap, moments]): StoryChapter => {
      const lead = moments.reduce((best, moment) =>
        (RANK[moment.eventKind] ?? 5) < (RANK[best.eventKind] ?? 5) ? moment : best,
      );
      return {
        id: `lap-${lap}`,
        lap,
        title: lead.title,
        lines: moments.map((moment) => moment.description),
        driverId: lead.driverId ?? null,
      };
    });

  const starter = leaderOn(visualization, first);
  const winner = leaderOn(visualization, last);

  return [
    {
      id: "start",
      lap: first,
      title: "Lights out",
      lines: [starter ? `${starter.driver.name} leads the opening lap.` : "The race starts."],
      driverId: starter?.driver.id ?? null,
    },
    ...middle,
    {
      id: "finish",
      lap: last,
      title: "Chequered flag",
      lines: [winner ? `${winner.driver.name} wins.` : "The race ends."],
      driverId: winner?.driver.id ?? null,
    },
  ];
}
