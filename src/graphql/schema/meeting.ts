import { asc, desc, eq } from 'drizzle-orm';
import { appConfig, circuits, meetings, races, seasons } from '@/db/schema';
import { builder } from '../builder';
import { Race } from './race';

export type MeetingRow = typeof meetings.$inferSelect;
type CircuitRow = typeof circuits.$inferSelect;

/**
 * A circuit as a place, not as a string on a race.
 *
 * `lengthKm`, `turns` and `firstGrandPrix` are nullable because they are a
 * hand-maintained overlay — Ergast publishes a name and a coordinate, and the
 * rest is not worth an API.
 */
export const Circuit = builder.objectRef<CircuitRow>('Circuit').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    ergastId: t.exposeString('ergastCircuitId'),
    name: t.exposeString('name'),
    locality: t.exposeString('locality', { nullable: true }),
    country: t.exposeString('country', { nullable: true }),
    latitude: t.exposeFloat('latitude', { nullable: true }),
    longitude: t.exposeFloat('longitude', { nullable: true }),
    lengthKm: t.exposeFloat('lengthKm', { nullable: true }),
    turns: t.exposeInt('turns', { nullable: true }),
    firstGrandPrix: t.exposeInt('firstGrandPrix', { nullable: true }),
  }),
});

export const Meeting = builder.objectRef<MeetingRow>('Meeting');

Meeting.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    round: t.exposeInt('round'),
    name: t.exposeString('name'),
    country: t.exposeString('country'),
    circuitName: t.exposeString('circuitName', { nullable: true }),
    // Null until an archive import has matched this meeting to a circuit row.
    // The name above still renders a race in the meantime.
    circuit: t.field({
      type: Circuit,
      nullable: true,
      resolve: async (meeting, _args, ctx) => {
        if (meeting.circuitId === null) return null;
        const circuit = await ctx.db.query.circuits.findFirst({
          where: eq(circuits.id, meeting.circuitId),
        });
        return circuit ?? null;
      },
    }),
    season: t.exposeInt('seasonYear'),
    adminEdited: t.exposeStringList('adminEdited'),
    startDate: t.field({ type: 'DateTime', resolve: (m) => m.startDate }),
    // A weekend's sessions: the grand prix, and a sprint where there was one.
    // This is the other half of the Race -> Meeting -> races cycle, which is
    // why the endpoint carries a depth limit.
    races: t.field({
      type: [Race],
      resolve: (meeting, _args, ctx) =>
        ctx.db.select().from(races)
          .where(eq(races.meetingId, meeting.id))
          .orderBy(asc(races.date)),
    }),
  }),
});

export const Season = builder.objectRef<{ year: number }>('Season').implement({
  fields: (t) => ({
    year: t.exposeInt('year'),
  }),
});

builder.queryField('seasons', (t) =>
  t.field({
    type: [Season],
    resolve: (_root, _args, ctx) =>
      ctx.db.select({ year: seasons.year }).from(seasons).orderBy(asc(seasons.year)),
  }),
);

/**
 * The season the site is currently about.
 *
 * One source of truth, and it is the one the ingest already obeys:
 * `app_config.active_season` is what the cron walks looking for races to
 * import. Before this, the home page and the standings default each held their
 * own hardcoded year, so the site could be — and was — a season behind the job
 * feeding it, with nothing failing to say so.
 *
 * The fallback is the newest season that has a race, not the calendar year. In
 * January the calendar year is a season nothing has happened in yet, and an
 * empty home page is a worse answer than a slightly stale one.
 */
builder.queryField('activeSeason', (t) =>
  t.int({
    resolve: async (_root, _args, ctx) => {
      const [config] = await ctx.db
        .select({ season: appConfig.activeSeason })
        .from(appConfig)
        .where(eq(appConfig.id, 1))
        .limit(1);
      if (config) return config.season;

      const [newest] = await ctx.db
        .selectDistinct({ year: meetings.seasonYear })
        .from(meetings)
        .innerJoin(races, eq(races.meetingId, meetings.id))
        .orderBy(desc(meetings.seasonYear))
        .limit(1);

      return newest?.year ?? new Date().getUTCFullYear();
    },
  }),
);
