import { describe, expect, it } from 'vitest';
import {
  FORM_WINDOW, MODEL_COLUMNS, buildFeatureRows, lineageOf, missingFromQualifying,
  normalisedFinish, toCsv, type Entry, type RaceInput,
} from './features';

function entry(driverCode: string, teamKey: string, finalPosition: number | null): Entry {
  return {
    driverCode,
    teamKey,
    qualiPosition: null,
    sprintFinishPosition: null,
    finalPosition,
    gridPosition: null,
  };
}

function race(round: number, entries: Entry[], upcoming = false): RaceInput {
  return {
    slug: `2025-r${round}`,
    season: 2025,
    round,
    date: new Date(Date.UTC(2025, 2, round * 7)),
    circuitId: `circuit-${round}`,
    upcoming,
    entries,
  };
}

const rowFor = (rows: ReturnType<typeof buildFeatureRows>, slug: string, driver: string) =>
  rows.find((row) => row.race_slug === slug && row.driver_code === driver)!;

describe('lineageOf', () => {
  it('follows a team through its rebrands', () => {
    expect(lineageOf({ name: 'Toro Rosso', ergastConstructorId: 'toro_rosso' })).toBe('rb');
    expect(lineageOf({ name: 'Force India', ergastConstructorId: 'force_india' })).toBe('aston_martin');
    expect(lineageOf({ name: 'Alfa Romeo', ergastConstructorId: 'alfa' })).toBe('audi');
    expect(lineageOf({ name: 'Renault', ergastConstructorId: 'renault' })).toBe('alpine');
  });

  it('fails on a team with no Ergast id, naming it', () => {
    expect(() => lineageOf({ name: 'Mystery GP', ergastConstructorId: null })).toThrow(/Mystery GP/);
  });

  it('fails on an id the map has never seen, rather than starting it with no history', () => {
    expect(() => lineageOf({ name: 'Andretti', ergastConstructorId: 'andretti' })).toThrow(/andretti/);
  });
});

describe('normalisedFinish', () => {
  it('is a share of the field, and an unclassified driver is last', () => {
    expect(normalisedFinish(2, 20)).toBe(0.1);
    expect(normalisedFinish(2, 22)).toBeCloseTo(0.0909);
    expect(normalisedFinish(null, 20)).toBe(1);
  });
});

describe('buildFeatureRows', () => {
  it('has no form for a first race: empty, not 0', () => {
    const rows = buildFeatureRows([race(1, [entry('VER', 'red_bull', 1), entry('NOR', 'mclaren', 2)])]);
    expect(rowFor(rows, '2025-r1', 'VER').driver_form).toBeNaN();
    expect(rowFor(rows, '2025-r1', 'VER').constructor_form).toBeNaN();
  });

  it('builds form from earlier races only: a later race changes nothing before it', () => {
    const r1 = race(1, [entry('VER', 'red_bull', 1), entry('NOR', 'mclaren', 2)]);
    const r2 = race(2, [entry('VER', 'red_bull', 2), entry('NOR', 'mclaren', 1)]);
    const r3 = race(3, [entry('VER', 'red_bull', null), entry('NOR', 'mclaren', 1)]);

    const without = buildFeatureRows([r1, r2]);
    // Shuffled on purpose: order comes from the date, not the input.
    const withLater = buildFeatureRows([r3, r1, r2]);

    for (const row of without) {
      expect(rowFor(withLater, row.race_slug as string, row.driver_code as string)).toEqual(row);
    }
    // And race 2 sees race 1 and nothing of its own result.
    expect(rowFor(withLater, '2025-r2', 'VER').driver_form).toBe(1 / 2);
  });

  it('averages the last FORM_WINDOW races and no more', () => {
    // Six races: P2 once, then P1 five times. The window drops the P2.
    const races = Array.from({ length: FORM_WINDOW + 2 }, (_, i) =>
      race(i + 1, [entry('VER', 'red_bull', i === 0 ? 2 : 1), entry('NOR', 'mclaren', i === 0 ? 1 : 2)]),
    );
    const rows = buildFeatureRows(races);
    expect(rowFor(rows, `2025-r${FORM_WINDOW + 2}`, 'VER').driver_form).toBe(1 / 2);
  });

  it('keeps driver and team form apart when a driver changes team', () => {
    const r1 = race(1, [entry('LAW', 'rb', 2), entry('TSU', 'red_bull', 1)]);
    // Lawson moves to Red Bull: his form comes with him, the team's stays.
    const r2 = race(2, [entry('LAW', 'red_bull', 1), entry('TSU', 'rb', 2)]);
    const rows = buildFeatureRows([r1, r2]);
    expect(rowFor(rows, '2025-r2', 'LAW').driver_form).toBe(1);
    expect(rowFor(rows, '2025-r2', 'LAW').constructor_form).toBe(1 / 2);
  });

  it('counts a team once per race, as the mean of its cars', () => {
    const r1 = race(1, [entry('NOR', 'mclaren', 1), entry('PIA', 'mclaren', 3), entry('VER', 'red_bull', 2), entry('HAM', 'ferrari', 4)]);
    const r2 = race(2, [entry('NOR', 'mclaren', 1), entry('PIA', 'mclaren', 2), entry('VER', 'red_bull', 3), entry('HAM', 'ferrari', 4)]);
    const rows = buildFeatureRows([r1, r2]);
    expect(rowFor(rows, '2025-r2', 'PIA').constructor_form).toBe((1 / 4 + 3 / 4) / 2);
  });

  it('labels a past race, leaves the upcoming one unlabelled, and adds nothing from it', () => {
    const r1 = race(1, [entry('VER', 'red_bull', 1), entry('NOR', 'mclaren', null)]);
    const next = race(2, [entry('VER', 'red_bull', null), entry('NOR', 'mclaren', null)], true);
    const rows = buildFeatureRows([r1, next]);

    expect(rowFor(rows, '2025-r1', 'VER')).toMatchObject({ finished_p1: true, classified: true });
    expect(rowFor(rows, '2025-r1', 'NOR')).toMatchObject({ finished_p1: false, classified: false });
    expect(rowFor(rows, '2025-r2', 'VER')).toMatchObject({ finished_p1: null, classified: null });
    expect(rowFor(rows, '2025-r2', 'VER').driver_form).toBe(1 / 2);
  });

  it('counts the field from the race, never assuming 20', () => {
    const rows = buildFeatureRows([race(1, ['A', 'B', 'C'].map((code, i) => entry(code, 'haas', i + 1)))]);
    expect(rowFor(rows, '2025-r1', 'A').field_size).toBe(3);
  });
});

describe('model columns', () => {
  it('never include the grid, which is only known with the result', () => {
    expect(MODEL_COLUMNS.filter((column) => column.includes('grid'))).toEqual([]);
  });
});

describe('missingFromQualifying', () => {
  it('fails only when there is no qualifying at all', () => {
    expect(() => missingFromQualifying('2026-x', [], ['VER', 'NOR'])).toThrow(/retry later/);
  });

  it('names who is missing from a short list instead of failing', () => {
    // 2026 R1 had 19 of 22: drivers without a time are not listed.
    expect(missingFromQualifying('2026-x', ['VER', 'NOR'], ['VER', 'NOR', 'STR'])).toEqual(['STR']);
    expect(missingFromQualifying('2026-x', ['VER', 'NOR'], ['VER', 'NOR'])).toEqual([]);
  });
});

describe('toCsv', () => {
  it('writes missing values as empty cells and booleans as 1/0', () => {
    const rows = buildFeatureRows([race(1, [entry('VER', 'red_bull', 1)])]);
    const [header, line] = toCsv(rows).trim().split('\n');
    const cells = Object.fromEntries(header.split(',').map((column, i) => [column, line.split(',')[i]]));
    expect(cells).toMatchObject({ driver_form: '', quali_position: '', finished_p1: '1', classified: '1' });
  });
});
