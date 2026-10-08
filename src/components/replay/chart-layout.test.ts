import { describe, expect, it } from 'vitest';
import { lapWindowFor, minFrameHeight } from './chart-layout';

describe('lapWindowFor', () => {
  it('shows the whole race on a desktop, however narrow the chart', () => {
    // An 800px chart beside the timing tower used to show laps 1-41 of 53.
    expect(lapWindowFor(800, 1, 53)).toEqual({ from: 1, to: 53 });
    expect(lapWindowFor(800, 40, 78)).toEqual({ from: 1, to: 78 });
  });

  it('windows the laps on a phone, centred on the current one', () => {
    const window = lapWindowFor(390, 30, 53);
    expect(window.to - window.from).toBeLessThan(52);
    expect(window.from).toBeLessThanOrEqual(30);
    expect(window.to).toBeGreaterThanOrEqual(30);
  });
});

describe('minFrameHeight', () => {
  it('gives a bigger grid more room', () => {
    expect(minFrameHeight(22)).toBeGreaterThan(minFrameHeight(18));
    // 21 gaps of 20px between P1 and P22, plus the margins.
    expect(minFrameHeight(22)).toBe(80 + 48 + 21 * 20);
  });
});
