import { eq, sql } from 'drizzle-orm';
import {
  driverTeamAssignments, drivers, meetings, raceResults, races, teamSeasons, teams,
} from '@/db/schema';
import { builder } from '../builder';
import { Driver, Team } from './entity';
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
 */

type DriverStandingShape = {
  position: number;
  driver: DriverRow;
  team: TeamRow;
  points: number;
  wins: number;
  podiums: number;
};

type ConstructorStandingShape = {
  position: number;
  team: TeamRow;
  points: number;
  wins: number;
};

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
          wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1)`.mapWith(Number),
          podiums: sql<number>`count(*) filter (where ${raceResults.finalPosition} <= 3)`.mapWith(Number),
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
        const team = { ...row.team, color: row.teamColor ?? row.team.color };
        const existing = byDriver.get(row.driver.id);
        if (!existing) {
          byDriver.set(row.driver.id, {
            position: 0, driver: row.driver, team,
            points: row.points, wins: row.wins, podiums: row.podiums,
            teamPoints: row.points,
          });
          continue;
        }
        existing.points += row.points;
        existing.wins += row.wins;
        existing.podiums += row.podiums;
        if (row.points > existing.teamPoints) {
          existing.team = team;
          existing.teamPoints = row.points;
        }
      }

      return [...byDriver.values()]
        .sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums)
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
          wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1)`.mapWith(Number),
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
          team: { ...row.team, color: row.teamColor ?? row.team.color },
          points: row.points,
          wins: row.wins,
        }))
        .sort((a, b) => b.points - a.points || b.wins - a.wins)
        .map((s, i) => ({ ...s, position: i + 1 }));
    },
  }),
);
