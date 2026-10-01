import { and, asc, eq, sql } from 'drizzle-orm';
import {
  driverTeamAssignments, drivers, meetings, raceResults, races, teamSeasons, teams,
} from '@/db/schema';
import { builder } from '../builder';
import { Driver, Team, withSeasonColor, seasonColorSql } from './entity';
import type { DriverRow, TeamRow } from './entity';

/**
 * Nothing here is stored. Standings are an aggregate over race_results
 * (document 02, Part 5), and `position` is the rank of the ordered result —
 * computed here, never a column, because a stored rank is a denormalisation
 * that goes stale the moment a penalty is applied after the flag.
 *
 * Two queries and two types rather than one `standings(season, type)`. A
 * driver standing has a driver and podiums; a constructor standing has
 * neither. Forcing both through one type means fields that are always null
 * for one of the two cases and clients writing `standing.driver!`.
 *
 * `points` sum every scored session, sprints included, because the
 * championship does. `wins` and `podiums` count grands prix only, because the
 * championship does that too — a sprint is won, but nobody's win count in a
 * published table includes it. Counting sprints put a 2025 win beside
 * Hamilton's name, who had none.
 */

type DriverStandingShape = {
  position: number;
  driver: DriverRow;
  team: TeamRow;
  points: number;
  wins: number;
  podiums: number;
  finishes: number[];
};

type ConstructorStandingShape = {
  position: number;
  team: TeamRow;
  points: number;
  wins: number;
  finishes: number[];
};

/**
 * The FIA tie-break: level on points, the entrant with more first places is
 * ahead, then more seconds, and so on down the order. Comparing wins and then
 * podiums — the obvious shortcut — stops discriminating at third, which is
 * where the real 2025 ties sat (Hadjar/Hulkenberg, Lawson/Ocon, Stroll/Tsunoda).
 * Sorts b before a when it returns a positive number, like every other
 * comparator here.
 *
 * The finishes counted are grand prix only. Sprint results carry points but no
 * countback position: include them and all three of those 2025 ties come out
 * in a different order from the published championship, and two of the three
 * come out backwards.
 */
export function countback(a: number[], b: number[]): number {
  const tally = (finishes: number[]) =>
    finishes.reduce((counts, p) => counts.set(p, (counts.get(p) ?? 0) + 1), new Map<number, number>());
  const [ta, tb] = [tally(a), tally(b)];
  for (const p of [...new Set([...ta.keys(), ...tb.keys()])].sort((x, y) => x - y)) {
    const diff = (tb.get(p) ?? 0) - (ta.get(p) ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const DriverStanding = builder.objectRef<DriverStandingShape>('DriverStanding').implement({
  fields: (t) => ({
    position: t.exposeInt('position'),
    driver: t.field({ type: Driver, resolve: (s) => s.driver }),
    team: t.field({ type: Team, resolve: (s) => s.team }),
    points: t.exposeFloat('points'),
    wins: t.exposeInt('wins'),
    podiums: t.exposeInt('podiums'),
  }),
});

const ConstructorStanding = builder.objectRef<ConstructorStandingShape>('ConstructorStanding').implement({
  fields: (t) => ({
    position: t.exposeInt('position'),
    team: t.field({ type: Team, resolve: (s) => s.team }),
    points: t.exposeFloat('points'),
    wins: t.exposeInt('wins'),
  }),
});

builder.queryField('driverStandings', (t) =>
  t.field({
    type: [DriverStanding],
    args: { season: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => {
      // A driver can change team mid-season (Lawson and Tsunoda did in 2025),
      // so points group by driver and the team shown is the one they scored
      // most of those points with — not an arbitrary row.
      const rows = await ctx.db
        .select({
          driver: drivers,
          team: teams,
          teamColor: teamSeasons.color,
          points: sql<number>`sum(${raceResults.points})`.mapWith(Number),
          wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
          podiums: sql<number>`count(*) filter (where ${raceResults.finalPosition} <= 3 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
          finishes: sql<number[]>`coalesce(array_remove(array_agg(${raceResults.finalPosition}) filter (where ${races.type} = 'GRAND_PRIX'), null), '{}')`,
        })
        .from(raceResults)
        .innerJoin(races, eq(races.id, raceResults.raceId))
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .innerJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
        .where(eq(meetings.seasonYear, args.season))
        .groupBy(drivers.id, teams.id, teamSeasons.color);

      const byDriver = new Map<string, DriverStandingShape & { teamPoints: number }>();
      for (const row of rows) {
        const team = withSeasonColor(row.team, row.teamColor);
        const existing = byDriver.get(row.driver.id);
        if (!existing) {
          byDriver.set(row.driver.id, {
            position: 0, driver: row.driver, team,
            points: row.points, wins: row.wins, podiums: row.podiums,
            finishes: row.finishes, teamPoints: row.points,
          });
          continue;
        }
        existing.points += row.points;
        existing.wins += row.wins;
        existing.podiums += row.podiums;
        existing.finishes = [...existing.finishes, ...row.finishes];
        if (row.points > existing.teamPoints) {
          existing.team = team;
          existing.teamPoints = row.points;
        }
      }

      return [...byDriver.values()]
        .sort((a, b) => b.points - a.points || countback(a.finishes, b.finishes))
        .map((s, i) => ({ ...s, position: i + 1 }));
    },
  }),
);

builder.queryField('constructorStandings', (t) =>
  t.field({
    type: [ConstructorStanding],
    args: { season: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const rows = await ctx.db
        .select({
          team: teams,
          teamColor: teamSeasons.color,
          points: sql<number>`sum(${raceResults.points})`.mapWith(Number),
          wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
          finishes: sql<number[]>`coalesce(array_remove(array_agg(${raceResults.finalPosition}) filter (where ${races.type} = 'GRAND_PRIX'), null), '{}')`,
        })
        .from(raceResults)
        .innerJoin(races, eq(races.id, raceResults.raceId))
        .innerJoin(meetings, eq(meetings.id, races.meetingId))
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
        .where(eq(meetings.seasonYear, args.season))
        .groupBy(teams.id, teamSeasons.color);

      return rows
        .map((row) => ({
          position: 0,
          team: withSeasonColor(row.team, row.teamColor),
          points: row.points,
          wins: row.wins,
          finishes: row.finishes,
        }))
        .sort((a, b) => b.points - a.points || countback(a.finishes, b.finishes))
        .map((s, i) => ({ ...s, position: i + 1 }));
    },
  }),
);

/**
 * The season at a glance: one entry per round, with whoever won it.
 *
 * Standings cannot give this. They are a sum over results, and a sum has no
 * memory of which race produced it — so "who won round 7" needs its own query
 * rather than a derivation from a table the home page already loads.
 *
 * Grands prix only. A sprint is a session inside a round, not a round, and a
 * strip with 31 dots for a 24-race season would be reading the calendar wrong.
 * A round with no winner yet is a round not yet run, which the UI draws hollow.
 */
type PulseRoundShape = {
  round: number;
  name: string;
  slug: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  winnerCode: string | null;
  teamName: string | null;
  teamColor: string | null;
};

const PulseStatus = builder.enumType('PulseRoundStatus', {
  values: ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const,
});

const PulseRound = builder.objectRef<PulseRoundShape>('PulseRound').implement({
  fields: (t) => ({
    round: t.exposeInt('round'),
    name: t.exposeString('name'),
    // Null where the round has not been run: there is no replay to link to.
    slug: t.exposeString('slug', { nullable: true }),
    status: t.field({ type: PulseStatus, resolve: (r) => r.status }),
    winnerCode: t.exposeString('winnerCode', { nullable: true }),
    // The team as it is stored, which is what the strip abbreviates — see
    // lib/team-monogram.ts.
    teamName: t.exposeString('teamName', { nullable: true }),
    teamColor: t.exposeString('teamColor', { nullable: true }),
  }),
});

builder.queryField('seasonPulse', (t) =>
  t.field({
    type: [PulseRound],
    args: { season: t.arg.int({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const rows = await ctx.db
        .select({
          round: meetings.round,
          name: meetings.name,
          slug: races.slug,
          status: races.status,
          winnerCode: drivers.code,
          teamName: teams.name,
          teamColor: seasonColorSql,
        })
        .from(meetings)
        .leftJoin(
          races,
          and(eq(races.meetingId, meetings.id), eq(races.type, 'GRAND_PRIX')),
        )
        .leftJoin(
          raceResults,
          and(eq(raceResults.raceId, races.id), eq(raceResults.finalPosition, 1)),
        )
        .leftJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
        .leftJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
        .leftJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .leftJoin(teams, eq(teams.id, teamSeasons.teamId))
        .where(eq(meetings.seasonYear, args.season))
        .orderBy(asc(meetings.round));

      return rows.map((row) => {
        const status = row.status ?? 'SCHEDULED';
        const run = status === 'COMPLETED';
        return {
          round: row.round,
          name: row.name,
          // A round that has not been run still has a page worth linking to:
          // it says when it is, or that it was cancelled.
          slug: row.slug,
          status,
          winnerCode: run ? row.winnerCode : null,
          teamName: run ? row.teamName : null,
          teamColor: run ? row.teamColor : null,
        };
      });
    },
  }),
);
