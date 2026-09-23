import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  circuits, driverTeamAssignments, drivers, meetings, raceResults, races,
  teamSeasons, teams,
} from '@/db/schema';
import { builder } from '../builder';
import { Circuit } from './meeting';
import { Driver, Team, driverColumns, teamColumns, type DriverRow, type TeamRow, withSeasonColor } from './entity';

/**
 * The archive: what the database knows about a driver, a team, a circuit or a
 * season, rather than about one race.
 *
 * Everything here is derived at read time from `race_results`, exactly as the
 * standings are and for the same reason — a stored career total is a
 * denormalisation that goes stale the moment a race is re-imported or a penalty
 * lands. These are aggregates over the seasons that happen to be in the
 * database; they are not claims about the whole history of the sport, and the
 * pages that render them say so.
 */

type SeasonRecordShape = {
  season: number;
  team: TeamRow | null;
  starts: number;
  wins: number;
  podiums: number;
  points: number;
  bestFinish: number | null;
};

const SeasonRecord = builder.objectRef<SeasonRecordShape>('SeasonRecord').implement({
  fields: (t) => ({
    season: t.exposeInt('season'),
    // Null for a constructor's own row, where the team is the subject.
    team: t.field({ type: Team, nullable: true, resolve: (r) => r.team }),
    starts: t.exposeInt('starts'),
    wins: t.exposeInt('wins'),
    podiums: t.exposeInt('podiums'),
    points: t.exposeFloat('points'),
    bestFinish: t.exposeInt('bestFinish', { nullable: true }),
  }),
});

/**
 * A career, summed from the season rows so the two can never disagree — a
 * total computed by a second query is a second chance to be wrong.
 */
const CareerTotals = builder
  .objectRef<{ seasons: SeasonRecordShape[] }>('CareerTotals')
  .implement({
    fields: (t) => ({
      seasons: t.field({ type: [SeasonRecord], resolve: (c) => c.seasons }),
      seasonCount: t.int({ resolve: (c) => c.seasons.length }),
      starts: t.int({ resolve: (c) => sum(c.seasons, (s) => s.starts) }),
      wins: t.int({ resolve: (c) => sum(c.seasons, (s) => s.wins) }),
      podiums: t.int({ resolve: (c) => sum(c.seasons, (s) => s.podiums) }),
      points: t.float({ resolve: (c) => sum(c.seasons, (s) => s.points) }),
      bestFinish: t.int({
        nullable: true,
        resolve: (c) => {
          const finishes = c.seasons.map((s) => s.bestFinish).filter((p): p is number => p !== null);
          return finishes.length > 0 ? Math.min(...finishes) : null;
        },
      }),
    }),
  });

const sum = <T>(rows: T[], of: (row: T) => number) =>
  rows.reduce((total, row) => total + of(row), 0);

/**
 * The aggregate every career page is built from.
 *
 * Wins and podiums count grands prix only, matching the standings resolvers —
 * a sprint is won, but no published career total includes it. `starts` counts
 * every scored session the entrant appeared in, including the ones they
 * retired from, because a start is a start.
 */
const careerColumns = {
  season: meetings.seasonYear,
  starts: sql<number>`count(*) filter (where ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  wins: sql<number>`count(*) filter (where ${raceResults.finalPosition} = 1 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  podiums: sql<number>`count(*) filter (where ${raceResults.finalPosition} <= 3 and ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
  points: sql<number>`sum(${raceResults.points})`.mapWith(Number),
  bestFinish: sql<number | null>`min(${raceResults.finalPosition}) filter (where ${races.type} = 'GRAND_PRIX')`.mapWith(Number),
};

// ── Driver ────────────────────────────────────────────────────────────

type DriverProfileShape = { driver: DriverRow };

const DriverProfile = builder.objectRef<DriverProfileShape>('DriverProfile').implement({
  fields: (t) => ({
    driver: t.field({ type: Driver, resolve: (p) => p.driver }),
    career: t.field({
      type: CareerTotals,
      resolve: async ({ driver }, _args, ctx) => {
        const rows = await ctx.db
          .select({ ...careerColumns, team: teams, teamColor: teamSeasons.color })
          .from(raceResults)
          .innerJoin(races, eq(races.id, raceResults.raceId))
          .innerJoin(meetings, eq(meetings.id, races.meetingId))
          .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
          .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
          .innerJoin(teams, eq(teams.id, teamSeasons.teamId))
          .where(eq(driverTeamAssignments.driverId, driver.id))
          .groupBy(meetings.seasonYear, teams.id, teamSeasons.color)
          .orderBy(desc(meetings.seasonYear));

        // A driver who changed team mid-season has two rows for that year. They
        // are kept separate rather than merged: "Racing Bulls, then Red Bull" is
        // the fact, and a merged row would have to pick one team and lie.
        return {
          seasons: rows.map((row) => ({
            season: row.season,
            team: withSeasonColor(row.team, row.teamColor),
            starts: row.starts,
            wins: row.wins,
            podiums: row.podiums,
            points: row.points,
            bestFinish: row.bestFinish,
          })),
        };
      },
    }),
  }),
});

builder.queryField('driver', (t) =>
  t.field({
    type: DriverProfile,
    nullable: true,
    // The code is the identifier a URL can carry and a person can type. It is
    // unique inside the seasons this project covers; see the schema comment.
    args: { code: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const driver = await ctx.db.query.drivers.findFirst({
        where: eq(drivers.code, args.code.toUpperCase()),
      });
      return driver ? { driver } : null;
    },
  }),
);

builder.queryField('drivers', (t) =>
  t.field({
    type: [Driver],
    args: { season: t.arg.int() },
    resolve: async (_root, args, ctx) => {
      if (args.season == null) {
        return ctx.db.select(driverColumns).from(drivers).orderBy(asc(drivers.name));
      }
      const rows = await ctx.db
        .selectDistinct({ driver: driverColumns })
        .from(drivers)
        .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.driverId, drivers.id))
        .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
        .where(eq(teamSeasons.seasonYear, args.season))
        .orderBy(asc(drivers.name));
      return rows.map((row) => row.driver);
    },
  }),
);

// ── Team ──────────────────────────────────────────────────────────────

type TeamProfileShape = { team: TeamRow };

const TeamProfile = builder.objectRef<TeamProfileShape>('TeamProfile').implement({
  fields: (t) => ({
    team: t.field({ type: Team, resolve: (p) => p.team }),
    career: t.field({
      type: CareerTotals,
      resolve: async ({ team }, _args, ctx) => {
        const rows = await ctx.db
          .select(careerColumns)
          .from(raceResults)
          .innerJoin(races, eq(races.id, raceResults.raceId))
          .innerJoin(meetings, eq(meetings.id, races.meetingId))
          .innerJoin(driverTeamAssignments, eq(driverTeamAssignments.id, raceResults.assignmentId))
          .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
          .where(eq(teamSeasons.teamId, team.id))
          .groupBy(meetings.seasonYear)
          .orderBy(desc(meetings.seasonYear));

        return {
          seasons: rows.map((row) => ({ ...row, team: null })),
        };
      },
    }),
    drivers: t.field({
      type: [Driver],
      args: { season: t.arg.int() },
      resolve: async ({ team }, args, ctx) => {
        const filters = [eq(teamSeasons.teamId, team.id)];
        if (args.season != null) filters.push(eq(teamSeasons.seasonYear, args.season));

        const rows = await ctx.db
          .selectDistinct({ driver: drivers })
          .from(driverTeamAssignments)
          .innerJoin(teamSeasons, eq(teamSeasons.id, driverTeamAssignments.teamSeasonId))
          .innerJoin(drivers, eq(drivers.id, driverTeamAssignments.driverId))
          .where(and(...filters))
          .orderBy(asc(drivers.name));
        return rows.map((row) => row.driver);
      },
    }),
  }),
});

builder.queryField('team', (t) =>
  t.field({
    type: TeamProfile,
    nullable: true,
    args: { name: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const team = await ctx.db.query.teams.findFirst({ where: eq(teams.name, args.name) });
      return team ? { team } : null;
    },
  }),
);

builder.queryField('teams', (t) =>
  t.field({
    type: [Team],
    // Same shape as `drivers(season:)`: without it the index lists every
    // constructor ever imported, which on a site about the current season is
    // eighteen teams for a ten-team grid.
    args: { season: t.arg.int() },
    resolve: async (_root, args, ctx) => {
      if (args.season == null) {
        return ctx.db.select(teamColumns).from(teams).orderBy(asc(teams.name));
      }
      const rows = await ctx.db
        .selectDistinct({ team: teamColumns })
        .from(teams)
        .innerJoin(teamSeasons, eq(teamSeasons.teamId, teams.id))
        .where(eq(teamSeasons.seasonYear, args.season))
        .orderBy(asc(teams.name));
      return rows.map((row) => row.team);
    },
  }),
);

// ── Circuit ───────────────────────────────────────────────────────────

/**
 * Every circuit, and deliberately no season argument.
 *
 * A circuit belongs to a season through `meetings.circuit_id`, and that column
 * is only written by an Ergast import — OpenF1 publishes a circuit *name*, not
 * an identity we can match a row on. Every season from 2023 is OpenF1-only, so
 * a season filter here answers "no circuits in 2026", which is worse than
 * listing them all.
 *
 * Drivers and teams do take a season, because both are linked through
 * `team_seasons`, which every import writes.
 */
builder.queryField('circuits', (t) =>
  t.field({
    type: [Circuit],
    resolve: (_root, _args, ctx) => ctx.db.select().from(circuits).orderBy(asc(circuits.name)),
  }),
);

builder.queryField('circuit', (t) =>
  t.field({
    type: Circuit,
    nullable: true,
    args: { ergastId: t.arg.string({ required: true }) },
    resolve: async (_root, args, ctx) => {
      const circuit = await ctx.db.query.circuits.findFirst({
        where: eq(circuits.ergastCircuitId, args.ergastId),
      });
      return circuit ?? null;
    },
  }),
);
