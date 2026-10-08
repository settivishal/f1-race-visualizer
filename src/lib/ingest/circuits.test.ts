import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbSchema from '@/db/schema';
import { linkCircuits } from './circuits';
import { fetchSeasonSchedule, type ErgastRace } from './ergast';

const calendar = vi.hoisted(() => ({ races: [] as unknown[] }));
vi.mock('./ergast', async (original) => ({
  ...(await original<typeof import('./ergast')>()),
  fetchSeasonSchedule: vi.fn(async () => calendar.races),
}));

let db: ReturnType<typeof drizzle<typeof dbSchema>>;
beforeEach(async () => {
  db = drizzle(new PGlite(), { schema: dbSchema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  vi.mocked(fetchSeasonSchedule).mockClear();
  await db.insert(dbSchema.seasons).values({ year: 2024 });
  // Ergast files Las Vegas under Saturday; OpenF1 starts it at 06:00 UTC Sunday.
  calendar.races = [{
    season: 2024, round: 22, raceName: 'Las Vegas Grand Prix', date: '2024-11-23',
    Circuit: { circuitId: 'vegas', circuitName: 'Las Vegas Strip Street Circuit', Location: { locality: 'Las Vegas', country: 'USA' } },
  } as unknown as ErgastRace];
});

async function meeting(round: number, date: string, status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') {
  const [row] = await db.insert(dbSchema.meetings).values({
    seasonYear: 2024, round, name: `GP ${round}`, country: 'USA', startDate: new Date(date),
  }).returning();
  await db.insert(dbSchema.races).values({
    meetingId: row.id, type: 'GRAND_PRIX', slug: `2024-${round}`, date: new Date(date), laps: 50, status,
  });
  return row.id;
}

describe('linkCircuits', () => {
  it('links a meeting to the circuit Ergast races on the same date, creating the row', async () => {
    const id = await meeting(22, '2024-11-24T06:00:00Z');
    expect(await linkCircuits(db, 2024)).toEqual({ linked: 1, warnings: [] });

    const row = await db.query.meetings.findFirst({ where: (m, { eq }) => eq(m.id, id) });
    const circuit = await db.query.circuits.findFirst();
    expect(circuit?.ergastCircuitId).toBe('vegas');
    expect(row?.circuitId).toBe(circuit?.id);
  });

  it('asks Ergast nothing when only cancelled or linked meetings are left', async () => {
    await meeting(22, '2024-11-24T06:00:00Z');
    await linkCircuits(db, 2024);
    await meeting(23, '2024-12-01T13:00:00Z', 'CANCELLED');
    vi.mocked(fetchSeasonSchedule).mockClear();

    expect(await linkCircuits(db, 2024)).toEqual({ linked: 0, warnings: [] });
    expect(fetchSeasonSchedule).not.toHaveBeenCalled();
  });
});
