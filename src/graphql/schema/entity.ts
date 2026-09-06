import type { drivers, teams } from '@/db/schema';
import { builder } from '../builder';

export type DriverRow = typeof drivers.$inferSelect;
export type TeamRow = typeof teams.$inferSelect;

export const Driver = builder.objectRef<DriverRow>('Driver').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    code: t.exposeString('code'),
    name: t.exposeString('name'),
    number: t.exposeInt('number', { nullable: true }),
    country: t.exposeString('country', { nullable: true }),
    headshotUrl: t.exposeString('headshotUrl', { nullable: true }),
  }),
});

export const Team = builder.objectRef<TeamRow>('Team').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    // Per-season livery wins where one exists; this is the fallback. The
    // resolver that had the team_season in hand has already applied it.
    color: t.exposeString('color', { nullable: true }),
    logoUrl: t.exposeString('logoUrl', { nullable: true }),
  }),
});
