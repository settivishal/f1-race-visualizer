type Row = {
  gridPosition?: number | null;
  finalPosition: number | null;
  lapsCompleted: number;
  status: string;
};

/** Laps behind the winner, for a classified finisher; 0 for anyone else. */
export function lapsDown(result: Row, raceLaps: number): number {
  if (result.status !== 'FINISHED' || result.finalPosition === null) return 0;
  return Math.max(0, raceLaps - result.lapsCompleted);
}

/**
 * Places gained from the grid: positive gained, negative lost. Null without
 * both ends — sprints carry no grid, a non-finisher has no result to compare,
 * and Ergast files a pit-lane start as grid 0, which is not P0.
 */
export function gridDelta(result: Row): number | null {
  const { gridPosition, finalPosition } = result;
  if (gridPosition == null || gridPosition <= 0 || finalPosition === null) return null;
  return gridPosition - finalPosition;
}
