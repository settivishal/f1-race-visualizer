import { eq } from 'drizzle-orm';
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

  const [circuit] = await db.insert(dbSchema.circuits).values({
    ergastCircuitId: 'test_circuit', name: 'Test Circuit',
    locality: 'Testville', country: 'Testland', latitude: 1.5, longitude: -2.5,
  }).returning();

  const [meeting] = await db.insert(dbSchema.meetings).values({
    seasonYear: 2025, round: 1, name: 'Test Grand Prix', country: 'Testland',
    startDate: new Date('2025-03-01T00:00:00Z'), openf1MeetingKey: 1,
    circuitId: circuit.id,
  }).returning();

  const [race] = await db.insert(dbSchema.races).values({
    meetingId: meeting.id, type: 'GRAND_PRIX', slug: '2025-test',
    date: new Date('2025-03-02T14:00:00Z'), laps: 3, openf1SessionKey: 1,
    // These rows are inserted directly rather than through writeRace, so the
    // status the ingest would have derived has to be stated here.
    status: 'COMPLETED',
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

  // A sprint in the same meeting: Norris wins it. Nothing about that belongs in
  // a published win or podium count, so the standings below must not see it —
  // only its points.
  const [sprint] = await db.insert(dbSchema.races).values({
    meetingId: meeting.id, type: 'SPRINT', slug: '2025-test-sprint',
    date: new Date('2025-03-01T14:00:00Z'), laps: 2, openf1SessionKey: 2,
    status: 'COMPLETED',
  }).returning();

  await db.insert(dbSchema.raceResults).values([
    { raceId: sprint.id, assignmentId: norSeat.id, finalPosition: 1, status: 'FINISHED', points: 8, lapsCompleted: 2 },
    { raceId: sprint.id, assignmentId: lecSeat.id, finalPosition: 2, status: 'FINISHED', points: 7, lapsCompleted: 2 },
  ]);

  // Norris pits on lap 1. Lap 2 has no rows at all, so lap 3 is the next lap he
  // recorded and therefore his out-lap — the case the missing-lap rule exists
  // for.
  await db.insert(dbSchema.pitStops).values([
    { raceId: race.id, assignmentId: norSeat.id, lap: 1, durationMs: 23400 },
  ]);

  await db.insert(dbSchema.stints).values([
    { raceId: race.id, assignmentId: norSeat.id, stintNumber: 1, lapStart: 1, lapEnd: 1, compound: 'MEDIUM', tyreAgeAtStart: 0 },
    { raceId: race.id, assignmentId: norSeat.id, stintNumber: 2, lapStart: 2, lapEnd: 3, compound: 'HARD', tyreAgeAtStart: 2 },
  ]);

  await db.insert(dbSchema.raceEvents).values([
    { raceId: race.id, lap: 2, assignmentId: null, type: 'SAFETY_CAR', details: 'Safety car deployed' },
    { raceId: race.id, lap: 3, assignmentId: norSeat.id, type: 'RETIREMENT', details: 'Engine' },
  ]);
});

describe('archive index filtering', () => {
  it('narrows drivers, teams and circuits to one season', async () => {
    const inSeason = await run<{
      drivers: { code: string }[]; teams: { name: string }[]; circuits: { name: string }[];
    }>(`query { drivers(season: 2025) { code } teams(season: 2025) { name } circuits { name } }`);

    expect(inSeason.drivers.map((d) => d.code).sort()).toEqual(['LEC', 'NOR']);
    expect(inSeason.teams.map((t) => t.name).sort()).toEqual(['Ferrari', 'McLaren']);
    // Circuits take no season: the meetings.circuit_id link is Ergast-only, so
    // filtering would answer "none" for every OpenF1 season.
    expect(inSeason.circuits.map((c) => c.name)).toEqual(['Test Circuit']);
  });

  it('returns nothing for a season with no races, rather than everything', async () => {
    // The bug this replaces: no season argument at all, so every page listed
    // the whole archive whatever the reader had selected.
    const empty = await run<{ drivers: unknown[]; teams: unknown[] }>(`query { drivers(season: 1999) { code } teams(season: 1999) { name } }`);

    expect(empty).toEqual({ drivers: [], teams: [] });
  });

  it('still lists everything with no season, which generateStaticParams needs', async () => {
    const all = await run<{ teams: { name: string }[] }>(`query { teams { name } }`);
    expect(all.teams.length).toBeGreaterThanOrEqual(2);
  });
});

describe('featuredRace', () => {
  it('is the newest race that has been run, not the newest race', async () => {
    // The calendar is stored whole, so the newest row by date is normally one
    // nobody has driven. `laps > 0` is the test rather than the clock, because
    // these resolvers are read from cache entries built at some other time.
    // Its own meeting: (meeting_id, type) is unique, so a season cannot hold
    // two grands prix in one round.
    const [later] = await db.insert(dbSchema.meetings).values({
      seasonYear: 2025, round: 2, name: 'Scheduled Grand Prix', country: 'Testland',
      startDate: new Date('2030-01-01T00:00:00Z'), openf1MeetingKey: 2,
    }).returning();
    await db.insert(dbSchema.races).values({
      meetingId: later.id, type: 'GRAND_PRIX', slug: '2025-scheduled',
      date: new Date('2030-01-01T00:00:00Z'), laps: 0, openf1SessionKey: 99,
      status: 'SCHEDULED',
    });

    const data = await run<{ featuredRace: { slug: string } }>(
      `query { featuredRace { slug } }`,
    );
    expect(data.featuredRace.slug).toBe('2025-test');

    await db.delete(dbSchema.races).where(eq(dbSchema.races.slug, '2025-scheduled'));
    await db.delete(dbSchema.meetings).where(eq(dbSchema.meetings.id, later.id));
  });

  it('prefers the flagged race, which is the only thing that reads is_featured', async () => {
    await db.update(dbSchema.races)
      .set({ isFeatured: true })
      .where(eq(dbSchema.races.slug, '2025-test-sprint'));

    const data = await run<{ featuredRace: { slug: string } }>(
      `query { featuredRace { slug } }`,
    );
    expect(data.featuredRace.slug).toBe('2025-test-sprint');

    await db.update(dbSchema.races).set({ isFeatured: false });
  });
});

describe('seasonPulse', () => {
  it('gives one entry per round with its winner, grands prix only', async () => {
    const data = await run<{
      seasonPulse: { round: number; winnerCode: string | null; teamColor: string | null }[];
    }>(`query { seasonPulse(season: 2025) { round winnerCode teamColor } }`);

    // One round in the fixture, won by Leclerc. The sprint in the same meeting
    // is a session inside it, not a round of its own.
    expect(data.seasonPulse).toHaveLength(1);
    expect(data.seasonPulse[0]).toMatchObject({ round: 1, winnerCode: 'LEC' });
    // The per-season livery, not the team's fallback colour.
    expect(data.seasonPulse[0].teamColor).toBe('#E8002D');
  });
});

describe('podium', () => {
  it('is the top three in order, with the per-season livery', async () => {
    const data = await run<{
      race: { podium: { position: number; code: string; teamColor: string | null }[] };
    }>(`query { race(slug: "2025-test-sprint") { podium { position code teamColor } } }`);

    // Norris then Leclerc, and a DNF has no position so nothing else appears.
    expect(data.race.podium).toEqual([
      // McLaren has no 2025 team_seasons colour, so the team's own is used.
      { position: 1, code: 'NOR', teamColor: '#FF8000' },
      { position: 2, code: 'LEC', teamColor: '#E8002D' },
    ]);
  });

  it('is empty for a race nobody has driven, rather than null', async () => {
    const [later] = await db.insert(dbSchema.meetings).values({
      seasonYear: 2025, round: 2, name: 'Scheduled Grand Prix', country: 'Testland',
      startDate: new Date('2030-01-01T00:00:00Z'), openf1MeetingKey: 2,
    }).returning();
    await db.insert(dbSchema.races).values({
      meetingId: later.id, type: 'GRAND_PRIX', slug: '2025-scheduled',
      date: new Date('2030-01-01T00:00:00Z'), laps: 0, openf1SessionKey: 99,
      status: 'SCHEDULED',
    });

    const data = await run<{ race: { podium: unknown[] }; nextRace: { slug: string } }>(
      `query { race(slug: "2025-scheduled") { podium { position } } nextRace { slug } }`,
    );
    expect(data.race.podium).toEqual([]);
    // And the same row is what the library calls upcoming: the earliest race
    // not yet run, not the newest by date.
    expect(data.nextRace.slug).toBe('2025-scheduled');

    await db.delete(dbSchema.races).where(eq(dbSchema.races.slug, '2025-scheduled'));
    await db.delete(dbSchema.meetings).where(eq(dbSchema.meetings.id, later.id));
  });

  it('has no next race when every race has been run', async () => {
    const data = await run<{ nextRace: null }>(`query { nextRace { slug } }`);
    expect(data.nextRace).toBeNull();
  });

  it('ignores a scheduled row older than the newest race run', async () => {
    // 2023 Imola is this shape in production: cancelled, never run, still
    // SCHEDULED. Earliest-scheduled alone would announce it as the next race.
    const [stale] = await db.insert(dbSchema.meetings).values({
      seasonYear: 2025, round: 3, name: 'Stale Grand Prix', country: 'Testland',
      startDate: new Date('2024-01-01T00:00:00Z'), openf1MeetingKey: 3,
    }).returning();
    await db.insert(dbSchema.races).values({
      meetingId: stale.id, type: 'GRAND_PRIX', slug: '2024-stale',
      date: new Date('2024-01-01T00:00:00Z'), laps: 0, openf1SessionKey: 98,
      status: 'SCHEDULED',
    });

    const data = await run<{ nextRace: null }>(`query { nextRace { slug } }`);
    expect(data.nextRace).toBeNull();

    await db.delete(dbSchema.races).where(eq(dbSchema.races.slug, '2024-stale'));
    await db.delete(dbSchema.meetings).where(eq(dbSchema.meetings.id, stale.id));
  });
});

describe('races paging', () => {
  const page = (args: string) => run<{
    races: {
      edges: { node: { slug: string } }[];
      pageInfo: {
        hasNextPage: boolean; hasPreviousPage: boolean;
        startCursor: string | null; endCursor: string | null;
      };
    };
  }>(`query { races(${args}) {
        edges { node { slug } }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      } }`);

  it('walks back to exactly the page it came from', async () => {
    // The fixture holds the sprint and the grand prix, in that date order.
    const first = await page('first: 1');
    expect(first.races.edges.map((e) => e.node.slug)).toEqual(['2025-test-sprint']);
    expect(first.races.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });

    const second = await page(`first: 1, after: "${first.races.pageInfo.endCursor}"`);
    expect(second.races.edges.map((e) => e.node.slug)).toEqual(['2025-test']);
    expect(second.races.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });

    // Stepping back is a keyset walk in the other direction, so the rows have
    // to come back in reading order rather than the order they were fetched.
    const back = await page(`first: 1, before: "${second.races.pageInfo.startCursor}"`);
    expect(back.races.edges.map((e) => e.node.slug)).toEqual(['2025-test-sprint']);
    expect(back.races.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
  });
});

describe('raceSlugs', () => {
  it('returns the newest race first, which is what the build has to prerender', async () => {
    // `races(first:)` orders ascending with no cursor and clamps at 100, so
    // asking it for the build's slug list prerendered the oldest hundred races
    // and left the current season rendering on demand. This is the fix, and the
    // ordering is the whole of it.
    const { raceSlugs } = await run<{ raceSlugs: { slug: string; date: string }[] }>(
      'query { raceSlugs { slug date } }',
    );

    const dates = raceSlugs.map((race) => new Date(race.date).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    // Every race, not a page of them.
    expect(raceSlugs.length).toBeGreaterThan(1);
  });
});

describe('activeSeason', () => {
  it('falls back to the newest season that has a race when nothing is configured', async () => {
    // The fixture inserts no app_config row, which is also the state of a fresh
    // database — and the case that must not answer with the calendar year, since
    // in January that is a season with nothing in it.
    const data = await run<{ activeSeason: number }>(`query { activeSeason }`);
    expect(data.activeSeason).toBe(2025);
  });

  it('prefers the configured season, which is the one the cron imports', async () => {
    await db.insert(dbSchema.appConfig).values({
      id: 1, ingestEnabled: true, runDays: ['mon'], activeSeason: 2026, hoursAfterRace: 12,
    });

    const data = await run<{ activeSeason: number }>(`query { activeSeason }`);
    expect(data.activeSeason).toBe(2026);

    // Left as it was found: the other suites in this file share the database.
    await db.delete(dbSchema.appConfig);
  });
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

  it('defaults an existing race to the FULL tier, since OpenF1 wrote it', async () => {
    const data = await run<{ race: { dataTier: string } }>(
      'query { race(slug: "2025-test") { dataTier } }',
    );
    expect(data.race.dataTier).toBe('FULL');
  });

  it('resolves the circuit a meeting was held at', async () => {
    const data = await run<{ race: { meeting: { circuitName: string; circuit: { name: string; locality: string; lengthKm: number | null } } } }>(`
      query {
        race(slug: "2025-test") {
          meeting { circuitName circuit { name locality lengthKm } }
        }
      }
    `);
    expect(data.race.meeting.circuit).toEqual({
      name: 'Test Circuit',
      locality: 'Testville',
      // The overlay fields are not in Ergast, so they stay null until a human
      // fills them in.
      lengthKm: null,
    });
  });

  it('returns null for a slug that does not exist', async () => {
    const data = await run<{ race: null }>('query { race(slug: "nope") { slug } }');
    expect(data.race).toBeNull();
  });
});

describe('analysis', () => {
  it('returns a lap-time series per driver, in lap order', async () => {
    const data = await run<{ race: { analysis: { lapTimes: { driver: { code: string }; laps: { lap: number; time: number }[] }[] } } }>(`
      query { race(slug: "2025-test") { analysis { lapTimes { driver { code } laps { lap time } } } } }
    `);
    const norris = data.race.analysis.lapTimes.find((d) => d.driver.code === 'NOR');
    expect(norris!.laps.map((l) => l.lap)).toEqual([1, 3]);
  });

  it('tells a race suspension apart from a pit stop, keeping both rows', async () => {
    // Upstream files the stationary time under a red flag as a pit stop, so a
    // stopped race arrives with one of these per car. Leclerc gets a half-hour
    // one here; Norris keeps his 23.4s stop from the fixture.
    const race = (await db.query.races.findFirst({
      where: eq(dbSchema.races.slug, '2025-test'),
    }))!;
    const [existing] = await db
      .select()
      .from(dbSchema.pitStops)
      .where(eq(dbSchema.pitStops.raceId, race.id));
    const [leclerc] = await db
      .select({ id: dbSchema.driverTeamAssignments.id })
      .from(dbSchema.driverTeamAssignments)
      .innerJoin(dbSchema.drivers, eq(dbSchema.drivers.id, dbSchema.driverTeamAssignments.driverId))
      .where(eq(dbSchema.drivers.code, 'LEC'));

    await db.insert(dbSchema.pitStops).values([
      { raceId: race.id, assignmentId: leclerc.id, lap: existing.lap, durationMs: 1_842_500 },
    ]);

    const data = await run<{
      race: { analysis: { pitStops: { lap: number; underStoppage: boolean }[] } };
    }>(`query { race(slug: "2025-test") { analysis { pitStops { lap underStoppage } } } }`);

    expect(data.race.analysis.pitStops).toEqual(
      expect.arrayContaining([
        { lap: 1, underStoppage: false },
        { lap: 1, underStoppage: true },
      ]),
    );

    await db.delete(dbSchema.pitStops).where(eq(dbSchema.pitStops.assignmentId, leclerc.id));
  });

  it('flags a pit lap and its out-lap rather than deleting them', async () => {
    const data = await run<{ race: { analysis: { lapTimes: { driver: { code: string }; laps: { lap: number; isOutlier: boolean }[]; pace: { lapsCounted: number; lapsExcluded: number; best: number } }[] } } }>(`
      query {
        race(slug: "2025-test") {
          analysis { lapTimes { driver { code } laps { lap isOutlier } pace { lapsCounted lapsExcluded best } } }
        }
      }
    `);
    const norris = data.race.analysis.lapTimes.find((d) => d.driver.code === 'NOR')!;
    // Both of his laps are still in the series — a chart with a hole in it looks
    // like missing data, which is a different fact.
    expect(norris.laps).toHaveLength(2);
    expect(norris.laps.every((l) => l.isOutlier)).toBe(true);
    expect(norris.pace.lapsCounted).toBe(0);
    expect(norris.pace.lapsExcluded).toBe(2);
    // The best lap survives the exclusion: a fast lap is a fact, not noise.
    expect(norris.pace.best).toBe(91.5);
  });

  it('returns stints with their compound', async () => {
    const data = await run<{ race: { analysis: { stints: { driver: { code: string }; compound: string; lapStart: number; lapEnd: number }[] } } }>(`
      query { race(slug: "2025-test") { analysis { stints { driver { code } compound lapStart lapEnd } } } }
    `);
    expect(data.race.analysis.stints).toEqual([
      { driver: { code: 'NOR' }, compound: 'MEDIUM', lapStart: 1, lapEnd: 1 },
      { driver: { code: 'NOR' }, compound: 'HARD', lapStart: 2, lapEnd: 3 },
    ]);
  });

  it('converts a stored millisecond duration to seconds on the wire', async () => {
    const data = await run<{ race: { analysis: { pitStops: { lap: number; durationSeconds: number }[] } } }>(`
      query { race(slug: "2025-test") { analysis { pitStops { lap durationSeconds } } } }
    `);
    expect(data.race.analysis.pitStops).toEqual([{ lap: 1, durationSeconds: 23.4 }]);
  });

  it('compares two drivers lap by lap', async () => {
    const data = await run<{ race: { analysis: { headToHead: { lapsAheadA: number; lapsAheadB: number; laps: { lap: number; positionDelta: number | null }[]; a: { finalPosition: number | null } } } } }>(`
      query {
        race(slug: "2025-test") {
          analysis {
            headToHead(driverA: "LEC", driverB: "NOR") {
              lapsAheadA lapsAheadB
              a { finalPosition }
              laps { lap positionDelta }
            }
          }
        }
      }
    `);
    const h = data.race.analysis.headToHead;
    expect(h.lapsAheadA).toBe(1);            // lap 1, P1 against P2
    expect(h.lapsAheadB).toBe(0);
    expect(h.a.finalPosition).toBe(1);
    // Lap 3 has no Leclerc row, so the comparison has no answer rather than a
    // zero — a null gap is not a dead heat.
    expect(h.laps.find((l) => l.lap === 3)!.positionDelta).toBeNull();
  });

  it('is null when a driver did not start the race', async () => {
    const data = await run<{ race: { analysis: { headToHead: null } } }>(`
      query { race(slug: "2025-test") { analysis { headToHead(driverA: "LEC", driverB: "VER") { lapsAheadA } } } }
    `);
    expect(data.race.analysis.headToHead).toBeNull();
  });
});

describe('standings', () => {
  it('derives points, wins and podiums without storing them', async () => {
    const data = await run<{ driverStandings: { position: number; driver: { code: string }; points: number; wins: number; podiums: number }[] }>(`
      query { driverStandings(season: 2025) { position driver { code } points wins podiums } }
    `);
    // Sprint points count — the championship counts them — but the sprint win
    // and the sprint second place do not reach the win and podium columns.
    expect(data.driverStandings).toEqual([
      { position: 1, driver: { code: 'LEC' }, points: 32, wins: 1, podiums: 1 },
      { position: 2, driver: { code: 'NOR' }, points: 8, wins: 0, podiums: 0 },
    ]);
  });

  it('ranks constructors from the same results', async () => {
    const data = await run<{ constructorStandings: { position: number; team: { name: string }; points: number }[] }>(`
      query { constructorStandings(season: 2025) { position team { name } points } }
    `);
    expect(data.constructorStandings[0]).toEqual({ position: 1, team: { name: 'Ferrari' }, points: 32 });
  });
});

describe('races pagination', () => {
  it('pages with a keyset cursor and reports whether more remain', async () => {
    const first = await run<{ races: { edges: { node: { slug: string }; cursor: string }[]; pageInfo: { hasNextPage: boolean } } }>(`
      query { races(first: 1) { edges { node { slug } cursor } pageInfo { hasNextPage endCursor } } }
    `);
    expect(first.races.edges).toHaveLength(1);
    // Two races are seeded — the grand prix and its sprint — so one page of one
    // leaves another behind.
    expect(first.races.pageInfo.hasNextPage).toBe(true);
  });

  it('filters by season', async () => {
    const data = await run<{ races: { edges: unknown[] } }>(
      'query { races(season: 2024) { edges { node { slug } } } }',
    );
    expect(data.races.edges).toEqual([]);
  });
});

describe('a weekend, not its sessions', () => {
  const weekend = () =>
    run<{
      races: { edges: { node: { slug: string; weekendSprint: { slug: string } | null } }[] };
    }>(`query { races(type: GRAND_PRIX) { edges { node { slug weekendSprint { slug } } } } }`);

  it('lists the grand prix once, carrying its own weekend’s sprint', async () => {
    // The fixture is one meeting with two sessions — exactly the shape that
    // used to render as two identical-looking cards.
    const data = await weekend();
    expect(data.races.edges.map((e) => e.node.slug)).toEqual(['2025-test']);
    expect(data.races.edges[0].node.weekendSprint?.slug).toBe('2025-test-sprint');
  });

  it('gives a sprint no sprint of its own', async () => {
    const data = await run<{ race: { weekendSprint: null } }>(
      `query { race(slug: "2025-test-sprint") { weekendSprint { slug } } }`,
    );
    expect(data.race.weekendSprint).toBeNull();
  });

  it('still finds a weekend by a term that only its sprint matches', async () => {
    // "sprint" appears in no meeting name and in no grand prix slug. Before the
    // search looked across the weekend's sessions, filtering to grands prix
    // made this a search that could never match anything.
    const data = await run<{ races: { edges: { node: { slug: string } }[] } }>(
      `query { races(type: GRAND_PRIX, search: "sprint") { edges { node { slug } } } }`,
    );
    expect(data.races.edges.map((e) => e.node.slug)).toEqual(['2025-test']);
  });
});
