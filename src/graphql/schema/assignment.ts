import type { builder } from '../builder';
import type { Context } from '../context';
import { Driver, Team, withSeasonColor } from './entity';

type Types = typeof builder extends PothosSchemaTypes.SchemaBuilder<infer T> ? T : never;

/**
 * The assignment is how storage links a driver to a team for a season
 * (document 02, Part 3). It is a storage concern and never appears in the
 * schema: a client asks a position for its `driver`, and the resolver walks the
 * assignment to find one.
 *
 * These still run once per parent object — a thousand position rows still call
 * them a thousand times. What changed is that they no longer issue a query
 * each: every .load() made in the same tick is collected into one
 * `WHERE id IN (...)`, and a key already fetched is served from the loader's
 * cache. The walk is the same; the round trips are not.
 */
export async function driverOfAssignment(ctx: Context, assignmentId: string) {
  const assignment = await ctx.loaders.assignmentById.load(assignmentId);
  if (!assignment) return null;
  return ctx.loaders.driverById.load(assignment.driverId);
}

export async function teamOfAssignment(ctx: Context, assignmentId: string) {
  const assignment = await ctx.loaders.assignmentById.load(assignmentId);
  if (!assignment) return null;
  const teamSeason = await ctx.loaders.teamSeasonById.load(assignment.teamSeasonId);
  if (!teamSeason) return null;
  const team = await ctx.loaders.teamById.load(teamSeason.teamId);
  if (!team) return null;
  return withSeasonColor(team, teamSeason.color);
}

/**
 * `driver` and `team` for any row that carries an assignment: the same two
 * fields on positions, results, stints, lap traces and head-to-head sides.
 */
export function assignmentFields<Parent extends { assignmentId: string }>(
  t: PothosSchemaTypes.ObjectFieldBuilder<Types, Parent>,
) {
  return {
    driver: t.field({
      type: Driver,
      nullable: true,
      resolve: (row, _args, ctx) => driverOfAssignment(ctx, row.assignmentId),
    }),
    team: t.field({
      type: Team,
      nullable: true,
      resolve: (row, _args, ctx) => teamOfAssignment(ctx, row.assignmentId),
    }),
  };
}
