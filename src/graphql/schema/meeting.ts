import { asc, eq } from 'drizzle-orm';
import { meetings, races, seasons } from '@/db/schema';
import { builder } from '../builder';
import { Race } from './race';

export type MeetingRow = typeof meetings.$inferSelect;

export const Meeting = builder.objectRef<MeetingRow>('Meeting');

Meeting.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    round: t.exposeInt('round'),
    name: t.exposeString('name'),
    country: t.exposeString('country'),
    circuitName: t.exposeString('circuitName', { nullable: true }),
    season: t.exposeInt('seasonYear'),
    startDate: t.field({ type: 'DateTime', resolve: (m) => m.startDate }),
    // Upstream's shape, passed through unread. Nothing in this codebase
    // depends on its keys, so modelling it as types would be inventing a
    // contract we do not have.
    weather: t.field({
      type: 'String',
      nullable: true,
      resolve: (m) => (m.weather === null ? null : JSON.stringify(m.weather)),
    }),
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
