import { sql } from 'drizzle-orm';
import { meetings, raceResults, races } from '@/db/schema';

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

/**
 * One season of a career, for a query joined to `races` and `meetings` and
 * grouped by season. `starts` counts grands prix the entrant appeared in,
 * retirements included, because a start is a start.
 */
export const careerColumns = {
  season: meetings.seasonYear,
  starts: sql<number>`count(*) filter (where ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  wins: resultTotals.wins,
  podiums: resultTotals.podiums,
  points: resultTotals.points,
  bestFinish: sql<number | null>`min(${raceResults.finalPosition}) filter (where ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
};
