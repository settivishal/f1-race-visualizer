import { sql } from 'drizzle-orm';
import { raceResults, races } from '@/db/schema';

/**
 * Totals over race results, for a query already joined to `races` and grouped.
 * Wins, podiums and finishes count grands prix only: a sprint is won, but no
 * published career or championship tally counts it as a win.
 */
export const resultTotals = {
  points: sql<number>`sum(${raceResults.points})`.mapWith(Number),
  wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  podiums: sql<number>`count(*) filter (where ${raceResults.finalPosition} <= 3 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  finishes: sql<number[]>`coalesce(array_remove(array_agg(${raceResults.finalPosition}) filter (where ${races.type} = 'GRAND_PRIX'), null), '{}')`,
};
