import { asc, eq, min, sql } from 'drizzle-orm';
import { drivers, teamSeasons, teams } from '@/db/schema';
import { lineageOf } from '@/lib/features';
import { builder } from '../builder';

/**
 * The columns these two types expose, and nothing else.
 *
 * `select()` with no column list returns every column of every row, and the
 * archive reads all of both tables — behind `generateStaticParams` for
 * /drivers, /teams and /circuits, so it runs on every deploy. The ingest keys
 * (`ergastDriverId`, `ergastConstructorId`), the number's provenance
 * (`numberSeason`) and both audit timestamps are never read outside the ingest
 * itself, and they were crossing the wire on every row.
 */
export const driverColumns = {
  id: drivers.id,
  code: drivers.code,
  name: drivers.name,
  number: drivers.number,
  country: drivers.country,
};

export const teamColumns = {
  id: teams.id,
  name: teams.name,
  color: teams.color,
};

export type DriverRow = { [K in keyof typeof driverColumns]: (typeof drivers.$inferSelect)[K] };
export type TeamRow = { [K in keyof typeof teamColumns]: (typeof teams.$inferSelect)[K] };

export const Driver = builder.objectRef<DriverRow>('Driver').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    code: t.exposeString('code'),
    name: t.exposeString('name'),
    number: t.exposeInt('number', { nullable: true }),
    country: t.exposeString('country', { nullable: true }),
  }),
});

export const Team = builder.objectRef<TeamRow>('Team').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    // Per-season livery wins where one exists; this is the fallback. The
    // resolver that had the team_season in hand has already applied it.
    color: t.exposeString('color', { nullable: true }),
  }),
});

/**
 * The per-season livery where a team has one, the team's standing colour
 * otherwise. The season is the more specific fact, so it wins.
 *
 * Written six ways before this: four object spreads and two SQL coalesces, one
 * of which carried a comment pointing at another. Both forms are here so the
 * rule has one definition whichever side of the wire it is applied on.
 */
export function withSeasonColor<T extends { color: string | null }>(
  team: T,
  seasonColor: string | null,
): T {
  return { ...team, color: seasonColor ?? team.color };
}

export const seasonColorSql = sql<string | null>`coalesce(${teamSeasons.color}, ${teams.color})`;

/**
 * The other names this team has raced under, oldest first: RB was Toro Rosso
 * and AlphaTauri. The same lineage map the win model uses, so the site and the
 * model agree on what a rebrand is. Unmapped is an empty list here, where the
 * feature builder would fail: a page has no reason to break over it.
 *
 * One read of the whole teams table, a few dozen rows. Only the team page asks.
 */
builder.objectField(Team, 'lineage', (t) =>
  t.field({
    type: [Team],
    resolve: async (team, _args, ctx) => {
      const rows = await ctx.db
        .select({ ...teamColumns, ergastConstructorId: teams.ergastConstructorId, first: min(teamSeasons.seasonYear) })
        .from(teams)
        .innerJoin(teamSeasons, eq(teamSeasons.teamId, teams.id))
        .groupBy(teams.id)
        .orderBy(asc(min(teamSeasons.seasonYear)));
      const keyOf = (row: (typeof rows)[number]) => {
        try {
          return lineageOf(row);
        } catch {
          return null;
        }
      };
      const self = rows.find((row) => row.id === team.id);
      const key = self ? keyOf(self) : null;
      if (key === null) return [];
      return rows
        .filter((row) => row.id !== team.id && keyOf(row) === key)
        .map(({ id, name, color }) => ({ id, name, color }));
    },
  }),
);

// A field rather than a column on Driver's row: the team is a fact about their
// most recent race, so it goes through the loader that already knows that.
builder.objectField(Driver, 'latestTeam', (t) =>
  t.field({
    type: Team,
    nullable: true,
    resolve: (driver, _args, ctx) => ctx.loaders.latestTeamByDriverId.load(driver.id),
  }),
);
