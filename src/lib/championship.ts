/**
 * Is the title still live?
 *
 * The site would be making a claim here, and a confidently wrong one is worse
 * than none — so the arithmetic is its own function with its own test rather
 * than an expression inside a component.
 *
 * Only the maximum still available is modelled: a win is 25 and a sprint win is
 * 8. The point for the fastest lap is not counted, because it was dropped for
 * 2025 onward and including it would overstate what is reachable in exactly the
 * seasons this site is about. Overstating is the safer direction anyway — it
 * says "still possible" one race longer than it truly is, rather than declaring
 * a title settled that is not.
 */

const WIN_POINTS = 25;
const SPRINT_WIN_POINTS = 8;

export type RemainingRounds = {
  grandsPrix: number;
  sprints: number;
};

export function pointsStillAvailable({ grandsPrix, sprints }: RemainingRounds): number {
  return grandsPrix * WIN_POINTS + sprints * SPRINT_WIN_POINTS;
}

/**
 * Whether the leader can still be caught.
 *
 * A gap exactly equal to the points remaining is *not* settled: the challenger
 * could draw level, and a tie is broken by countback rather than by the leader
 * keeping it. The site's standings already break ties that way.
 */
export function isTitleSettled(pointsGap: number, remaining: RemainingRounds): boolean {
  return pointsGap > pointsStillAvailable(remaining);
}

/**
 * Points as a person writes them.
 *
 * Half points exist — a shortened race pays them — so the column is a Float,
 * and a whole total should still read as a whole number rather than "25.0".
 */
export const formatPoints = (points: number) =>
  Number.isInteger(points) ? String(points) : points.toFixed(1);
