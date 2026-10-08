import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import * as dbSchema from '@/db/schema';
import { writeRace } from './write';
import type { TransformedRace } from './types';

/**
 * The two upstreams writing the same rows.
 *
 * This is the failure the archive makes possible and nothing else could: OpenF1
 * knows the livery and the session key, Ergast knows the grid and the circuit,
 * and each import must leave the other's columns standing. Assigning instead of
 * coalescing produces a database whose contents depend on which import ran last
 * — plausible-looking, wrong, and invisible until someone notices Ferrari has
 * gone grey.
 *
 * Against PGlite with the real migrations, so the constraints are the real ones.
 */
type Db = ReturnType<typeof drizzle<typeof dbSchema>>;
let db: Db;

const base = {
  meeting: {
    seasonYear: 2019,
    round: 1,
    name: 'Australian Grand Prix',
    country: 'Australia',
    circuitName: 'Melbourne',
    startDate: new Date('2019-03-17T05:10:00Z'),
    weather: null,
    openf1MeetingKey: null as number | null,
  },
  race: {
    type: 'GRAND_PRIX' as const,
    slug: '2019-melbourne',
    date: new Date('2019-03-17T05:10:00Z'),
    laps: 58,
    openf1SessionKey: null as number | null,
  },
  positions: [],
  events: [],
  stints: [],
  pitStops: [],
  warnings: [],
};

/** What an OpenF1 import of this race looks like: livery, keys, no grid. */
const fromOpenF1: TransformedRace = {
  ...base,
  meeting: { ...base.meeting, openf1MeetingKey: 1234, weather: [{ air_temperature: 21 }] },
  race: { ...base.race, openf1SessionKey: 9999, dataTier: 'FULL' },
  lineup: [{
    driverNumber: 44, code: 'HAM', name: 'Lewis Hamilton', country: 'GBR',
    headshotUrl: 'https://example.test/ham.png',
    teamName: 'Mercedes', teamColor: '#00D7B6',
  }],
  results: [{
    driverNumber: 44, finalPosition: 2, status: 'FINISHED',
    lapsCompleted: 58, points: 18, fastestLap: false,
  }],
};

/** What an Ergast import of the same race looks like: grid, circuit, no livery. */
const fromErgast: TransformedRace = {
  ...base,
  meeting: {
    ...base.meeting,
    circuit: {
      ergastCircuitId: 'albert_park', name: 'Albert Park Grand Prix Circuit',
      locality: 'Melbourne', country: 'Australia', latitude: -37.8497, longitude: 144.968,
    },
  },
  race: { ...base.race, dataTier: 'LAPS', ergastRound: 1 },
  lineup: [{
    driverNumber: 44, code: 'HAM', name: 'Lewis Hamilton', country: 'British',
    headshotUrl: null,
    teamName: 'Mercedes', teamColor: null,
    ergastDriverId: 'hamilton', ergastConstructorId: 'mercedes',
  }],
  results: [{
    driverNumber: 44, finalPosition: 2, status: 'FINISHED',
    lapsCompleted: 58, points: 18, fastestLap: false, gridPosition: 1,
  }],
};

beforeEach(async () => {
  db = drizzle(new PGlite(), { schema: dbSchema });
  await migrate(db, { migrationsFolder: './src/db/migrations' });
});

const raceRow = () => db.query.races.findFirst({ where: eq(dbSchema.races.slug, '2019-melbourne') });
const teamRow = () => db.query.teams.findFirst({ where: eq(dbSchema.teams.name, 'Mercedes') });
const meetingRow = () =>
  db.query.meetings.findFirst({ where: eq(dbSchema.meetings.round, 1) });
const resultRow = async () => {
  const rows = await db.select().from(dbSchema.raceResults);
  return rows[0];
};

describe('two upstreams, one race', () => {
  it('meets on the same row rather than inserting a second one', async () => {
    await writeRace(fromOpenF1, db);
    await writeRace(fromErgast, db);

    expect(await db.select().from(dbSchema.races)).toHaveLength(1);
    expect(await db.select().from(dbSchema.meetings)).toHaveLength(1);
  });

  it('keeps the livery when an import that has none writes over it', async () => {
    await writeRace(fromOpenF1, db);
    await writeRace(fromErgast, db);

    // The failure this exists for: Ergast publishes no colour, and assigning
    // would blank a team's colour across every season it has ever raced.
    expect((await teamRow())?.color).toBe('#00D7B6');
    expect((await teamRow())?.ergastConstructorId).toBe('mercedes');
  });

  it('does not let the archive\'s guessed colour overwrite the timing feed\'s', async () => {
    await writeRace(fromOpenF1, db);
    await writeRace(
      { ...fromErgast, lineup: [{ ...fromErgast.lineup[0], teamColor: '#123456' }] },
      db,
    );

    // The archive's colours are a hand-maintained lookup — enough to make a
    // 2019 chart readable, not a correction to a colour read off the feed.
    expect((await teamRow())?.color).toBe('#00D7B6');
  });

  it('still takes the archive colour for a team OpenF1 has never seen', async () => {
    await writeRace(
      {
        ...fromErgast,
        lineup: [{
          ...fromErgast.lineup[0],
          teamName: 'Racing Point', teamColor: '#F596C8',
          ergastConstructorId: 'racing_point',
        }],
      },
      db,
    );

    const team = await db.query.teams.findFirst({
      where: eq(dbSchema.teams.name, 'Racing Point'),
    });
    expect(team?.color).toBe('#F596C8');
  });

  it('keeps the grid when the OpenF1 import runs second', async () => {
    await writeRace(fromErgast, db);
    await writeRace(fromOpenF1, db);

    // OpenF1 publishes no starting grid at all. Re-importing a 2023+ race must
    // not erase the one the archive filled in.
    expect((await resultRow()).gridPosition).toBe(1);
    // ...and the OpenF1 facts still land.
    expect((await raceRow())?.openf1SessionKey).toBe(9999);
    expect((await meetingRow())?.openf1MeetingKey).toBe(1234);
  });

  it('keeps the circuit and the weather, each known to only one source', async () => {
    await writeRace(fromOpenF1, db);
    await writeRace(fromErgast, db);

    const meeting = await meetingRow();
    expect(meeting?.circuitId).not.toBeNull();
    expect(meeting?.weather).not.toBeNull();

    const circuit = await db.query.circuits.findFirst();
    expect(circuit?.ergastCircuitId).toBe('albert_park');
    expect(circuit?.locality).toBe('Melbourne');
  });

  it('lets the last writer set the tier, since that is a claim about itself', async () => {
    await writeRace(fromErgast, db);
    expect((await raceRow())?.dataTier).toBe('LAPS');

    // An OpenF1 re-import means this race now *has* sectors and stints, so it
    // is a FULL race — the tier is not something to preserve.
    await writeRace(fromOpenF1, db);
    expect((await raceRow())?.dataTier).toBe('FULL');
  });

  it('is idempotent: importing twice changes no row counts', async () => {
    await writeRace(fromErgast, db);
    const first = await db.select().from(dbSchema.raceResults);

    await writeRace(fromErgast, db);
    const second = await db.select().from(dbSchema.raceResults);

    expect(second).toHaveLength(first.length);
    expect(await db.select().from(dbSchema.drivers)).toHaveLength(1);
    expect(await db.select().from(dbSchema.circuits)).toHaveLength(1);
  });
});

/**
 * Numbers change: a champion runs 1. The driver row holds one number, so which
 * import wins matters — and it used to be simply the last one, which meant
 * backfilling 2018 after 2026 would put a driver back on the number they ran
 * eight years ago, everywhere on the site.
 */
describe('a driver number belongs to a season', () => {
  const withNumber = (seasonYear: number, slug: string, driverNumber: number): TransformedRace => ({
    ...base,
    meeting: { ...base.meeting, seasonYear, openf1MeetingKey: null },
    race: { ...base.race, slug, date: new Date(`${seasonYear}-03-17T05:10:00Z`) },
    lineup: [{
      driverNumber, code: 'VER', name: 'Max Verstappen', country: 'NED',
      headshotUrl: null, teamName: 'Red Bull Racing', teamColor: '#3671C6',
    }],
    results: [],
  });

  const stored = async () => {
    const [row] = await db
      .select({ number: dbSchema.drivers.number, season: dbSchema.drivers.numberSeason })
      .from(dbSchema.drivers)
      .where(eq(dbSchema.drivers.code, 'VER'));
    return row;
  };

  it('takes the number from the newer season, whichever import runs last', async () => {
    await writeRace(withNumber(2026, '2026-melbourne', 1), db);
    await writeRace(withNumber(2018, '2018-melbourne', 33), db);

    expect(await stored()).toEqual({ number: 1, season: 2026 });
  });

  it('still moves forward when the seasons arrive in order', async () => {
    await writeRace(withNumber(2018, '2018-melbourne', 33), db);
    expect(await stored()).toEqual({ number: 33, season: 2018 });

    await writeRace(withNumber(2026, '2026-melbourne', 1), db);
    expect(await stored()).toEqual({ number: 1, season: 2026 });
  });

  it('lets a re-import of the same season correct the number', async () => {
    await writeRace(withNumber(2026, '2026-melbourne', 33), db);
    await writeRace(withNumber(2026, '2026-melbourne', 1), db);

    expect(await stored()).toEqual({ number: 1, season: 2026 });
  });
});

/**
 * Upstream is a default, not the truth.
 *
 * The admin editor for a meeting's name, country and circuit has existed since
 * M3, and every edit it made was reverted by the next weekly import, because
 * the upsert assigned those columns. The test that matters is therefore the
 * second write, not the first.
 */
describe('an admin correction survives the next import', () => {
  const meetingRow = async () => {
    const [row] = await db
      .select()
      .from(dbSchema.meetings)
      .where(eq(dbSchema.meetings.seasonYear, 2019));
    return row;
  };

  it('keeps a pinned column and takes an unpinned one', async () => {
    await writeRace(fromOpenF1, db);

    // What an admin does: correct the country, and record that they did.
    await db.update(dbSchema.meetings)
      .set({ country: 'Malaysia', adminEdited: ['country'] })
      .where(eq(dbSchema.meetings.seasonYear, 2019));

    await writeRace(fromOpenF1, db);

    const row = await meetingRow();
    expect(row.country).toBe('Malaysia');
    // The name was never pinned, so upstream still owns it.
    expect(row.name).toBe('Australian Grand Prix');
  });

  it('hands a field back to upstream once the pin is released', async () => {
    await writeRace(fromOpenF1, db);
    await db.update(dbSchema.meetings)
      .set({ country: 'Malaysia', adminEdited: ['country'] })
      .where(eq(dbSchema.meetings.seasonYear, 2019));
    await writeRace(fromOpenF1, db);

    // Clearing the field in the admin drops it from the list. That is the undo.
    await db.update(dbSchema.meetings)
      .set({ adminEdited: [] })
      .where(eq(dbSchema.meetings.seasonYear, 2019));
    await writeRace(fromOpenF1, db);

    expect((await meetingRow()).country).toBe('Australia');
  });
});

describe('race status', () => {
  const status = async () => {
    const [row] = await db
      .select({ status: dbSchema.races.status })
      .from(dbSchema.races)
      .where(eq(dbSchema.races.slug, '2019-melbourne'));
    return row.status;
  };

  const withPositions: TransformedRace = {
    ...fromOpenF1,
    positions: [{ lap: 1, driverNumber: 44, position: 1, gap: null, lapTime: null,
      sector1: null, sector2: null, sector3: null }],
  };

  it('is SCHEDULED until a race has positions, then COMPLETED', async () => {
    await writeRace(fromOpenF1, db);
    expect(await status()).toBe('SCHEDULED');

    await writeRace(withPositions, db);
    expect(await status()).toBe('COMPLETED');
  });

  it('never demotes a completed race, however empty a later import is', async () => {
    await writeRace(withPositions, db);
    // Upstream having a bad day is not a race un-happening.
    await writeRace(fromOpenF1, db);
    expect(await status()).toBe('COMPLETED');
  });

  it('keeps CANCELLED, which no import can ever produce', async () => {
    await writeRace(withPositions, db);
    await db.update(dbSchema.races)
      .set({ status: 'CANCELLED', adminEdited: ['status'] })
      .where(eq(dbSchema.races.slug, '2019-melbourne'));

    await writeRace(withPositions, db);
    expect(await status()).toBe('CANCELLED');
  });
});

describe('one team, many names', () => {
  const withTeam = (race: TransformedRace, teamName: string, ergastConstructorId: string) => ({
    ...race,
    lineup: [{ ...race.lineup[0], teamName, ergastConstructorId }],
  });

  it('keeps a rebrand on the team it already is', async () => {
    await writeRace(withTeam(fromOpenF1, 'RB', 'rb'), db);
    await writeRace(withTeam(fromOpenF1, 'Racing Bulls', 'rb'), db);

    const rows = await db.select().from(dbSchema.teams);
    expect(rows.map((team) => team.name)).toEqual(['RB']);
  });

  it('meets the archive\'s name for a team on the same row', async () => {
    await writeRace(withTeam(fromOpenF1, 'Red Bull Racing', 'red_bull'), db);
    // Before the id lookup this was a second "Red Bull" row, rejected by the
    // unique constraint on ergast_constructor_id, which failed the import.
    await writeRace(withTeam(fromErgast, 'Red Bull', 'red_bull'), db);

    const rows = await db.select().from(dbSchema.teams);
    expect(rows.map((team) => team.name)).toEqual(['Red Bull Racing']);
  });
});
