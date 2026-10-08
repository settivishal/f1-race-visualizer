import { describe, expect, it } from 'vitest';
import { adjacentGrandsPrix, nextByClock, raceHeaderFact, untilLabel, weekendPhase } from '@/lib/schedule';

const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const NOW = Date.parse('2026-03-01T12:00:00Z');

describe('untilLabel', () => {
  it('shows the largest whole unit, and only that one', () => {
    expect(untilLabel(at(6 * 1440), NOW)).toBe('in 6 days');
    // 25 hours is a day and an hour; the hour is not mentioned.
    expect(untilLabel(at(25 * 60), NOW)).toBe('in 1 day');
    expect(untilLabel(at(4 * 60), NOW)).toBe('in 4 hours');
    expect(untilLabel(at(12), NOW)).toBe('in 12 minutes');
  });

  it('singularises the unit it lands on', () => {
    expect(untilLabel(at(1440), NOW)).toBe('in 1 day');
    expect(untilLabel(at(60), NOW)).toBe('in 1 hour');
    expect(untilLabel(at(1), NOW)).toBe('in 1 minute');
  });

  it('says a race is starting rather than counting past zero', () => {
    expect(untilLabel(at(0), NOW)).toBe('Starting now');
    // A race already under way is still "starting now" — the countdown does not
    // run backwards, and this component stops caring once the race has begun.
    expect(untilLabel(at(-90), NOW)).toBe('Starting now');
  });
});

describe('raceHeaderFact', () => {
  const date = '2026-12-06T13:00:00Z';

  it('gives a run race its lap count', () => {
    expect(raceHeaderFact({ status: 'COMPLETED', date, laps: 58 })).toBe('58 laps');
  });

  it('gives a race still to come its date, never "0 laps"', () => {
    expect(raceHeaderFact({ status: 'SCHEDULED', date, laps: 0 })).toBe('Sun 6 Dec');
  });

  it('says a cancelled race was cancelled', () => {
    expect(raceHeaderFact({ status: 'CANCELLED', date, laps: 0 })).toBe('Cancelled');
  });
});

describe('untilLabel after the race window', () => {
  it('says results are pending rather than "Starting now" for weeks', () => {
    expect(untilLabel(at(-181), NOW)).toBe('Results pending');
    expect(untilLabel(at(-19 * 1440), NOW)).toBe('Results pending');
  });
});

describe('nextByClock', () => {
  const madring = { slug: 'madring', date: at(-19 * 1440) };
  const baku = { slug: 'baku', date: at(-6 * 1440) };
  const sepang = { slug: 'sepang', date: at(2 * 1440) };

  it('skips races that have run, imported or not', () => {
    expect(nextByClock([sepang, madring, baku], NOW)?.slug).toBe('sepang');
  });

  it('keeps a race that is on right now', () => {
    const live = { slug: 'live', date: at(-60) };
    expect(nextByClock([sepang, live], NOW)?.slug).toBe('live');
  });

  it('is null once the season is over', () => {
    expect(nextByClock([madring, baku], NOW)).toBeNull();
  });
});

describe('adjacentGrandsPrix', () => {
  // Newest first, as raceSlugs returns them.
  const row = (slug: string, type = 'GRAND_PRIX') => ({ slug, date: '', type, name: slug });
  const rows = [row('c'), row('c-sprint', 'SPRINT'), row('b'), row('a')];

  it('links the grands prix either side, skipping sprints', () => {
    expect(adjacentGrandsPrix(rows, 'b')).toEqual({ previous: row('a'), next: row('c') });
  });

  it('has no previous for the first race and no next for the newest', () => {
    expect(adjacentGrandsPrix(rows, 'a').previous).toBeNull();
    expect(adjacentGrandsPrix(rows, 'c').next).toBeNull();
  });

  it('links nothing from a slug it does not list', () => {
    expect(adjacentGrandsPrix(rows, 'c-sprint')).toEqual({ previous: null, next: null });
  });
});

describe('weekendPhase', () => {
  const spain = { slug: 'spain', date: at(9 * 1440), weekendStart: at(7 * 1440) };
  const italy = { slug: 'italy', date: at(2 * 1440), weekendStart: at(-60) };

  it('is race week from the weekend start until the race window closes', () => {
    expect(weekendPhase([spain, italy], NOW)).toEqual({ race: italy, raceWeek: true });
  });

  it('calls the next race upcoming in the gap before its weekend', () => {
    const done = { ...italy, date: at(-4 * 60) };
    expect(weekendPhase([spain, done], NOW)).toEqual({ race: spain, raceWeek: false });
  });

  it('is nothing once the season has run', () => {
    expect(weekendPhase([], NOW)).toBeNull();
  });
});
