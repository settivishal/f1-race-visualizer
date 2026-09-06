import { PGlite } from '@electric-sql/pglite';
import { execute, parse } from 'graphql';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import * as dbSchema from '@/db/schema';
import { createLoaders } from '../loaders';
import { schema } from './index';

/**
 * Resolvers are tested through execute() — the same entry point server
 * components use — against PGlite: real Postgres in-process, with the real
 * migrations applied. So these exercise the real schema, the real resolvers
 * and real SQL rather than a mock, and a broken migration fails the run.
 */
type Db = ReturnType<typeof drizzle<typeof dbSchema>>;
let db: Db;

async function run<T>(document: string, variableValues?: Record<string, unknown>): Promise<T> {
  const result = await execute({
    schema,
    document: parse(document),
    variableValues,
    contextValue: { db, loaders: createLoaders(db), session: null },
  });
  if (result.errors?.length) throw result.errors[0];
  return result.data as T;
}

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema: dbSchema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });

  await db.insert(dbSchema.seasons).values({ year: 2025 });

  const [ferrari] = await db.insert(dbSchema.teams)
    .values({ name: 'Ferrari', color: '#DC0000' }).returning();
  const [mclaren] = await db.insert(dbSchema.teams)
    .values({ name: 'McLaren', color: '#FF8000' }).returning();

  const [leclerc] = await db.insert(dbSchema.drivers)
    .values({ code: 'LEC', name: 'Charles Leclerc', number: 16 }).returning();
  const [norris] = await db.insert(dbSchema.drivers)
    .values({ code: 'NOR', name: 'Lando Norris', number: 4 }).returning();

  const [ferrari25] = await db.insert(dbSchema.teamSeasons)
    .values({ seasonYear: 2025, teamId: ferrari.id, color: '#E8002D' }).returning();
  const [mclaren25] = await db.insert(dbSchema.teamSeasons)
    .values({ seasonYear: 2025, teamId: mclaren.id }).returning();

  const [lecSeat] = await db.insert(dbSchema.driverTeamAssignments)
    .values({ teamSeasonId: ferrari25.id, driverId: leclerc.id }).returning();
  const [norSeat] = await db.insert(dbSchema.driverTeamAssignments)
    .values({ teamSeasonId: mclaren25.id, driverId: norris.id }).returning();

  const [meeting] = await db.insert(dbSchema.meetings).values({
    seasonYear: 2025, round: 1, name: 'Test Grand Prix', country: 'Testland',
    startDate: new Date('2025-03-01T00:00:00Z'), openf1MeetingKey: 1,
  }).returning();

  const [race] = await db.insert(dbSchema.races).values({
    meetingId: meeting.id, type: 'GRAND_PRIX', slug: '2025-test',
    date: new Date('2025-03-02T14:00:00Z'), laps: 3, openf1SessionKey: 1,
  }).returning();

  // Lap 2 is deliberately absent and lap 3 has one car in P2 with no P1: both
  // shapes occur in the real 2025 data and the resolvers must not assume
  // otherwise.
  await db.insert(dbSchema.racePositions).values([
    { raceId: race.id, lap: 1, assignmentId: lecSeat.id, position: 1, lapTime: 92.1 },
    { raceId: race.id, lap: 1, assignmentId: norSeat.id, position: 2, lapTime: 92.8 },
    { raceId: race.id, lap: 3, assignmentId: norSeat.id, position: 2, lapTime: 91.5 },
  ]);

  await db.insert(dbSchema.raceResults).values([
    { raceId: race.id, assignmentId: lecSeat.id, finalPosition: 1, status: 'FINISHED', points: 25, lapsCompleted: 3 },
    { raceId: race.id, assignmentId: norSeat.id, finalPosition: null, status: 'DNF', points: 0, lapsCompleted: 2 },
  ]);

  await db.insert(dbSchema.raceEvents).values([
    { raceId: race.id, lap: 2, assignmentId: null, type: 'SAFETY_CAR', details: 'Safety car deployed' },
    { raceId: race.id, lap: 3, assignmentId: norSeat.id, type: 'RETIREMENT', details: 'Engine' },
  ]);
});

describe('race', () => {
  it('resolves a driver and team through the assignment, which the schema never exposes', async () => {
    const data = await run<{ race: { positions: { driver: { code: string }; team: { name: string; color: string } }[] } }>(`
      query { race(slug: "2025-test") { positions(lap: 1) { position driver { code } team { name color } } } }
    `);
    expect(data.race.positions.map((p) => p.driver.code)).toEqual(['LEC', 'NOR']);
    // The per-season livery wins over teams.color where one exists.
    expect(data.race.positions[0].team).toEqual({ name: 'Ferrari', color: '#E8002D' });
    // McLaren's team_season has no colour, so it falls back to the team's.
    expect(data.race.positions[1].team).toEqual({ name: 'McLaren', color: '#FF8000' });
  });

  it('reports the laps that exist rather than a 1..N range', async () => {
    const data = await run<{ race: { replay: { laps: number[]; summary: { lapCount: number; maxLap: number; driverCount: number } } } }>(`
      query { race(slug: "2025-test") { replay { laps summary { lapCount maxLap driverCount } } } }
    `);
    // Lap 2 has no position rows, so it is absent — not interpolated, not zero.
    expect(data.race.replay.laps).toEqual([1, 3]);
    expect(data.race.replay.summary).toEqual({ lapCount: 2, maxLap: 3, driverCount: 2 });
  });

  it('pivots the replay by driver, each series in lap order', async () => {
    const data = await run<{ race: { replay: { drivers: { driver: { code: string }; positions: { lap: number }[] }[] } } }>(`
      query { race(slug: "2025-test") { replay { drivers { driver { code } positions { lap } } } } }
    `);
    const norrisSeries = data.race.replay.drivers.find((d) => d.driver.code === 'NOR');
    expect(norrisSeries!.positions.map((p) => p.lap)).toEqual([1, 3]);
  });

  it('keeps a race-wide event, which has no driver', async () => {
    const data = await run<{ race: { events: { type: string; driver: { code: string } | null }[] } }>(`
      query { race(slug: "2025-test") { events { type driver { code } } } }
    `);
    expect(data.race.events).toEqual([
      { type: 'SAFETY_CAR', driver: null },
      { type: 'RETIREMENT', driver: { code: 'NOR' } },
    ]);
  });

  it('sorts an unclassified finisher last rather than first', async () => {
    const data = await run<{ race: { results: { status: string; finalPosition: number | null }[] } }>(`
      query { race(slug: "2025-test") { results { status finalPosition } } }
    `);
    // A null final_position must not sort ahead of P1.
    expect(data.race.results).toEqual([
      { status: 'FINISHED', finalPosition: 1 },
      { status: 'DNF', finalPosition: null },
    ]);
  });

  it('returns null for a slug that does not exist', async () => {
    const data = await run<{ race: null }>('query { race(slug: "nope") { slug } }');
    expect(data.race).toBeNull();
  });
});

describe('standings', () => {
  it('derives points, wins and podiums without storing them', async () => {
    const data = await run<{ driverStandings: { position: number; driver: { code: string }; points: number; wins: number }[] }>(`
      query { driverStandings(season: 2025) { position driver { code } points wins } }
    `);
    expect(data.driverStandings).toEqual([
      { position: 1, driver: { code: 'LEC' }, points: 25, wins: 1 },
      { position: 2, driver: { code: 'NOR' }, points: 0, wins: 0 },
    ]);
  });

  it('ranks constructors from the same results', async () => {
    const data = await run<{ constructorStandings: { position: number; team: { name: string }; points: number }[] }>(`
      query { constructorStandings(season: 2025) { position team { name } points } }
    `);
    expect(data.constructorStandings[0]).toEqual({ position: 1, team: { name: 'Ferrari' }, points: 25 });
  });
});

describe('races pagination', () => {
  it('pages with a keyset cursor and reports whether more remain', async () => {
    const first = await run<{ races: { edges: { node: { slug: string }; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(`
      query { races(first: 1) { edges { node { slug } cursor } pageInfo { hasNextPage endCursor } } }
    `);
    expect(first.races.edges).toHaveLength(1);
    expect(first.races.pageInfo.hasNextPage).toBe(false);
  });

  it('filters by season', async () => {
    const data = await run<{ races: { edges: unknown[] } }>(
      'query { races(season: 2024) { edges { node { slug } } } }',
    );
    expect(data.races.edges).toEqual([]);
  });
});
