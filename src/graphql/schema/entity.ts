import { sql } from 'drizzle-orm';
import { drivers, teamSeasons, teams } from '@/db/schema';
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
