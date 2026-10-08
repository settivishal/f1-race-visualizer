import { describe, expect, it } from 'vitest';
import { lapWindowFor, minFrameHeight, trailPositions } from './chart-layout';

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

describe('trailPositions', () => {
  const at = (lap: number, position: number) => ({ lap, position }) as Parameters<typeof trailPositions>[0][number];

  it('carries a car with no row for the lap to the playhead at its last position', () => {
    // Spa 2026: lap 45 holds only the leader's row.
    expect(trailPositions([at(43, 3), at(44, 2)], 45, true).map((p) => [p.lap, p.position])).toEqual([
      [43, 3],
      [44, 2],
      [45, 2],
    ]);
  });

  it('leaves a retired car where it stopped', () => {
    expect(trailPositions([at(10, 5)], 12, false)).toHaveLength(1);
  });
});
