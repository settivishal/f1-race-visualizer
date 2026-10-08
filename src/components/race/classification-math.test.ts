import { describe, expect, it } from 'vitest';
import { gridDelta, lapsDown } from './classification-math';

const row = (over: Partial<Parameters<typeof lapsDown>[0]> = {}) => ({
  gridPosition: 5,
  finalPosition: 3,
  lapsCompleted: 58,
  status: 'FINISHED',
  ...over,
});

describe('lapsDown', () => {
  it('counts laps behind the winner for a classified finisher', () => {
    expect(lapsDown(row({ lapsCompleted: 56 }), 58)).toBe(2);
    expect(lapsDown(row(), 58)).toBe(0);
  });

  it('is 0 for a retirement or a car that was not classified', () => {
    expect(lapsDown(row({ status: 'DNF', finalPosition: null, lapsCompleted: 21 }), 58)).toBe(0);
    expect(lapsDown(row({ finalPosition: null, lapsCompleted: 43 }), 58)).toBe(0);
  });
});

describe('gridDelta', () => {
  it('is places gained, positive up and negative down', () => {
    expect(gridDelta(row({ gridPosition: 12, finalPosition: 4 }))).toBe(8);
    expect(gridDelta(row({ gridPosition: 1, finalPosition: 3 }))).toBe(-2);
    expect(gridDelta(row({ gridPosition: 3, finalPosition: 3 }))).toBe(0);
  });

  it('is null without a grid, a pit-lane start, or a finishing position', () => {
    expect(gridDelta(row({ gridPosition: null }))).toBeNull();
    expect(gridDelta(row({ gridPosition: 0 }))).toBeNull();
    expect(gridDelta(row({ finalPosition: null }))).toBeNull();
  });
});
