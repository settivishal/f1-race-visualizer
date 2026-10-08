import { describe, expect, it } from 'vitest';
import { first, seasonFilter, yearParam } from './search-params';

describe('search params', () => {
  it('takes the first of a repeated parameter', () => {
    expect(first(['a', 'b'])).toBe('a');
    expect(first('a')).toBe('a');
    expect(first(undefined)).toBeUndefined();
  });

  it('reads a year and nothing else', () => {
    expect(yearParam('2024')).toBe(2024);
    expect(yearParam(['2023', '2024'])).toBe(2023);
    expect(yearParam('all')).toBeUndefined();
    expect(yearParam('20.5')).toBeUndefined();
    expect(yearParam('')).toBeUndefined();
  });

  it('filters to all seasons, a year, or the fallback', async () => {
    const fallback = async () => 2026;
    expect(await seasonFilter('all', fallback)).toBeNull();
    expect(await seasonFilter('2019', fallback)).toBe(2019);
    expect(await seasonFilter(undefined, fallback)).toBe(2026);
    expect(await seasonFilter('nonsense', fallback)).toBe(2026);
  });
});
