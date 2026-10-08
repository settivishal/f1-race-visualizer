import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbSchema from '@/db/schema';
import type { ErgastRace } from './ergast';
import { fillGrids } from './grid';
import { writeRace } from './write';
import type { TransformedRace } from './types';

const archive = vi.hoisted(() => ({ races: [] as unknown[] }));
vi.mock('./ergast', async (original) => ({
  ...(await original<typeof import('./ergast')>()),
  fetchSeasonResults: vi.fn(async () => archive.races),
}));

let db: ReturnType<typeof drizzle<typeof dbSchema>>;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema: dbSchema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  archive.races = [];
});

/** Las Vegas 2024 as OpenF1 has it: 06:00 UTC on Sunday, no grid. */
const vegas: TransformedRace = {
  meeting: {
    seasonYear: 2024, round: 22, name: 'Las Vegas Grand Prix', country: 'United States',
    circuitName: 'Las Vegas', startDate: new Date('2024-11-24T06:00:00Z'), weather: null,
    openf1MeetingKey: 1250,
  },
  race: {
    type: 'GRAND_PRIX', slug: '2024-las-vegas', date: new Date('2024-11-24T06:00:00Z'),
    laps: 50, openf1SessionKey: 9644, dataTier: 'FULL',
  },
  lineup: [
    { driverNumber: 63, code: 'RUS', name: 'George Russell', country: 'GBR', headshotUrl: null, teamName: 'Mercedes', teamColor: '#00D7B6' },
    { driverNumber: 44, code: 'HAM', name: 'Lewis Hamilton', country: 'GBR', headshotUrl: null, teamName: 'Mercedes', teamColor: '#00D7B6' },
  ],
  results: [
    { driverNumber: 63, finalPosition: 1, status: 'FINISHED', lapsCompleted: 50, points: 25, fastestLap: false },
    { driverNumber: 44, finalPosition: 2, status: 'FINISHED', lapsCompleted: 50, points: 18, fastestLap: false },
  ],
  // A position row is what makes the race COMPLETED.
  positions: [{ lap: 1, driverNumber: 63, position: 1, gap: null, lapTime: null, sector1: null, sector2: null, sector3: null }],
  events: [], stints: [], pitStops: [], warnings: [],
};

/** Ergast files it under Saturday. */
const ergastVegas = {
  season: 2024, round: 22, date: '2024-11-23',
  Results: [
    { Driver: { code: 'RUS' }, grid: 1 },
    { Driver: { code: 'HAM' }, grid: 10 },
  ],
} as unknown as ErgastRace;

const grids = async () =>
  Object.fromEntries((await db.select().from(dbSchema.raceResults)).map((r) => [r.points, r.gridPosition]));

describe('fillGrids', () => {
  it('fills a race Ergast dates a day early', async () => {
    await writeRace(vegas, db);
    archive.races = [ergastVegas];

    expect(await fillGrids(db, 2024)).toEqual({ filled: 2, warnings: [] });
    expect(await grids()).toEqual({ 25: 1, 18: 10 });
  });

  it('writes only blank cells, and asks Ergast nothing once none are left', async () => {
    await writeRace(vegas, db);
    archive.races = [ergastVegas];
    await fillGrids(db, 2024);

    archive.races = [{ ...ergastVegas, Results: [{ Driver: { code: 'RUS' }, grid: 5 }] }];
    expect(await fillGrids(db, 2024)).toEqual({ filled: 0, warnings: [] });
    expect(await grids()).toEqual({ 25: 1, 18: 10 });
  });

  it('leaves the grid blank and says so when Ergast has not caught up', async () => {
    await writeRace(vegas, db);

    expect(await fillGrids(db, 2024)).toEqual({
      filled: 0,
      warnings: ['2024-las-vegas: Ergast has no race on 2024-11-24 yet'],
    });
    expect(await grids()).toEqual({ 25: null, 18: null });
  });

  it('only looks back as far as it is asked to', async () => {
    await writeRace(vegas, db);
    archive.races = [ergastVegas];

    expect(await fillGrids(db, 2024, { since: new Date('2024-12-01') })).toEqual({ filled: 0, warnings: [] });
  });
});
