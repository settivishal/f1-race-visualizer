import { PGlite } from '@electric-sql/pglite';
import { execute, parse } from 'graphql';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import * as dbSchema from '@/db/schema';
import { createLoaders } from './loaders';
import { schema } from './schema';

type Db = ReturnType<typeof drizzle<typeof dbSchema>>;
let db: Db;
let client: PGlite;
let driverIds: string[];

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client, { schema: dbSchema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });

  await db.insert(dbSchema.seasons).values({ year: 2025 });
  const [team] = await db.insert(dbSchema.teams).values({ name: 'Ferrari' }).returning();
  const [teamSeason] = await db.insert(dbSchema.teamSeasons)
    .values({ seasonYear: 2025, teamId: team.id }).returning();

  const inserted = await db.insert(dbSchema.drivers).values(
    ['ALB', 'BOR', 'COL', 'GAS', 'HAM'].map((code, i) => ({ code, name: `Driver ${code}`, number: i + 1 })),
  ).returning();
  driverIds = inserted.map((d) => d.id);

  const [meeting] = await db.insert(dbSchema.meetings).values({
    seasonYear: 2025, round: 1, name: 'Test GP', country: 'Testland',
    startDate: new Date('2025-03-01T00:00:00Z'), openf1MeetingKey: 1,
  }).returning();
  const [race] = await db.insert(dbSchema.races).values({
    meetingId: meeting.id, type: 'GRAND_PRIX', slug: '2025-count',
    date: new Date('2025-03-02T14:00:00Z'), laps: 40, openf1SessionKey: 1,
  }).returning();

  const seats = await db.insert(dbSchema.driverTeamAssignments).values(
    inserted.map((d) => ({ teamSeasonId: teamSeason.id, driverId: d.id })),
  ).returning();

  // 40 laps x 5 drivers = 200 position rows, enough that a per-row lookup
  // would be plainly visible in the query count below.
  await db.insert(dbSchema.racePositions).values(
    Array.from({ length: 40 }, (_, lap) =>
      seats.map((seat, i) => ({
        raceId: race.id, lap: lap + 1, assignmentId: seat.id, position: i + 1,
      })),
    ).flat(),
  );
});

describe('the DataLoader contract', () => {
  it('returns rows in the order the keys were asked for, not the order Postgres returns them', async () => {
    const loaders = createLoaders(db);
    // Reversed, so a loader handing back the database's own ordering would
    // pass every id to the wrong caller — the classic bug, which produces
    // wrong data rather than an error.
    const asked = [...driverIds].reverse();
    const rows = await Promise.all(asked.map((id) => loaders.driverById.load(id)));
    expect(rows.map((r) => r!.id)).toEqual(asked);
  });

  it('returns null for a key with no row, keeping the array aligned', async () => {
    const loaders = createLoaders(db);
    const missing = '00000000-0000-0000-0000-000000000000';
    const rows = await Promise.all(
      [driverIds[0], missing, driverIds[1]].map((id) => loaders.driverById.load(id)),
    );
    // A loader that simply returned what the query found would drop the middle
    // entry and shift the third answer onto the second caller.
    expect(rows.map((r) => r?.id ?? null)).toEqual([driverIds[0], null, driverIds[1]]);
  });

  it('fetches a repeated key once', async () => {
    const loaders = createLoaders(db);
    const [a, b] = await Promise.all([
      loaders.driverById.load(driverIds[0]),
      loaders.driverById.load(driverIds[0]),
    ]);
    expect(a).toBe(b);
  });
});

describe('query count', () => {
  it('is bounded by entity types, not by row count', async () => {
    let count = 0;
    const realQuery = client.query.bind(client);
    Object.assign(client, {
      query: (...args: Parameters<typeof realQuery>) => {
        count++;
        return realQuery(...args);
      },
    });

    const result = await execute({
      schema,
      document: parse(`
        query { race(slug: "2025-count") { positions { position driver { code } team { name } } } }
      `),
      contextValue: { db, loaders: createLoaders(db), session: null },
    });
    Object.assign(client, { query: realQuery });

    expect(result.errors).toBeUndefined();
    const positions = (result.data as { race: { positions: unknown[] } }).race.positions;
    expect(positions).toHaveLength(200);

    // One for the race, one for its positions, then one per entity type:
    // assignments, drivers, team_seasons, teams. Without the loaders this same
    // query costs 200 x 5 + 2 = 1,002.
    expect(count).toBe(6);
  });
});
