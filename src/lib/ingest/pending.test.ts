import { describe, expect, it } from 'vitest';
import type { Session } from './openf1';
import { selectPending, type StoredRace } from './pending';

const NOW = Date.parse('2026-10-02T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const race = (key: number, daysAgo: number, name = 'Race'): Session => ({
  session_key: key,
  meeting_key: key,
  session_name: name,
  session_type: 'Race',
  date_start: new Date(NOW - daysAgo * DAY - 2 * 60 * 60 * 1000).toISOString(),
  date_end: new Date(NOW - daysAgo * DAY).toISOString(),
  year: 2026,
  circuit_short_name: 'X',
  country_name: 'X',
});

const select = (sessions: Session[], stored: Record<number, StoredRace> = {}) =>
  selectPending(sessions, new Map(Object.entries(stored).map(([k, v]) => [Number(k), v])), {
    now: NOW,
    hoursAfterRace: 12,
  });

describe('selectPending', () => {
  it('skips a cancelled round, which is how Sakhir 2026 stalled the import', () => {
    const sakhir = race(11261, 170);
    const madring = race(11369, 19);
    const { pending } = select([madring, sakhir], {
      11261: { status: 'CANCELLED', hasPositions: false, attempts: [] },
    });
    expect(pending).toEqual([11369]);
  });

  it('returns every missing race, oldest first, not just one', () => {
    const { pending } = select([race(3, 3), race(1, 19), race(2, 6)]);
    expect(pending).toEqual([1, 2, 3]);
  });

  it('retries a race whose import wrote nothing, and leaves complete ones alone', () => {
    const { pending } = select([race(1, 3), race(2, 3)], {
      1: { status: 'SCHEDULED', hasPositions: false, attempts: [NOW - 2 * DAY] },
      2: { status: 'COMPLETED', hasPositions: true, attempts: [NOW - 2 * DAY] },
    });
    expect(pending).toEqual([1]);
  });

  it('waits until the race has settled', () => {
    expect(select([race(1, 0.25)]).pending).toEqual([]);
  });

  it('gives up on a session still empty a week after its first attempt', () => {
    const { pending, abandoned } = select([race(1, 170)], {
      1: { status: 'SCHEDULED', hasPositions: false, attempts: [NOW - 160 * DAY] },
    });
    expect(abandoned).toEqual([1]);
    expect(pending).toEqual([]);
  });

  it('never gives up on a race that was missed rather than tried', () => {
    // Madring during the September outage: a calendar row, 19 days old, no
    // attempt. Its age alone must not count against it.
    const { pending, abandoned } = select([race(1, 19)], {
      1: { status: 'SCHEDULED', hasPositions: false, attempts: [] },
    });
    expect(pending).toEqual([1]);
    expect(abandoned).toEqual([]);
  });

  it('ignores attempts made before the race was held', () => {
    // The calendar import tried Madring on 8 Sep; the race was 13 Sep.
    const { pending, abandoned } = select([race(1, 19)], {
      1: { status: 'SCHEDULED', hasPositions: false, attempts: [NOW - 24 * DAY] },
    });
    expect(pending).toEqual([1]);
    expect(abandoned).toEqual([]);
  });

  it('ignores sessions that score no points', () => {
    expect(select([race(1, 3, 'Qualifying')]).pending).toEqual([]);
  });
});
