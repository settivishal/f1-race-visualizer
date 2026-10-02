import { describe, expect, it } from 'vitest';
import { raceHeaderFact, untilLabel } from '@/lib/schedule';

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
