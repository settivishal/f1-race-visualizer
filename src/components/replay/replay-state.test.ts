import { describe, expect, it } from 'vitest';
import {
  describeMissingLaps,
  nearestLapIndex,
  withFocusLast,
  buildRaceControlByLap,
  classifyReplayEvent,
  easeLapProgress,
} from './replay-state';
import type { ReplayEntry, ReplayEvent, ReplayPosition } from './types';

function entry(id: string, positions: ReplayPosition[]): ReplayEntry {
  return {
    driver: { id, code: id.toUpperCase(), name: `Driver ${id}`, number: 1 },
    team: { id: `team-${id}`, name: 'Team', color: '#ff0000' },
    positions,
  };
}

function event(lap: number, type: string, details = ''): ReplayEvent {
  return { lap, type, details, driver: null };
}

describe('classifyReplayEvent', () => {
  it('reads the more specific flag when two names overlap', () => {
    // "double yellow" contains "yellow", and "virtual safety car" contains
    // "safety car". Order of checks is what keeps these apart.
    expect(classifyReplayEvent(event(1, 'DOUBLE YELLOW'))).toBe('double-yellow');
    expect(classifyReplayEvent(event(1, 'VIRTUAL SAFETY CAR'))).toBe('virtual-safety-car');
    expect(classifyReplayEvent(event(1, 'SAFETY CAR'))).toBe('safety-car');
    expect(classifyReplayEvent(event(1, 'YELLOW'))).toBe('yellow');
  });

  it('classifies from the details when the type says nothing', () => {
    expect(classifyReplayEvent(event(1, 'RACE_CONTROL', 'Car 44 in the pits'))).toBe('pit');
    expect(classifyReplayEvent(event(1, 'RACE_CONTROL', 'Retired — engine'))).toBe('dnf');
  });

  it('falls back to other rather than guessing', () => {
    expect(classifyReplayEvent(event(1, 'SOMETHING_NEW', 'no keyword here'))).toBe('other');
  });
});

describe('buildRaceControlByLap', () => {
  it('holds a flag across the laps that follow it until something clears it', () => {
    const laps = [1, 2, 3, 4, 5];
    const control = buildRaceControlByLap(laps, [
      event(2, 'SAFETY CAR', 'deployed'),
      event(4, 'GREEN', 'clear'),
    ]);

    expect(control.get(1)?.status).toBe('green');
    expect(control.get(2)?.status).toBe('safety-car');
    // Lap 3 has no event of its own and stays under the safety car.
    expect(control.get(3)?.status).toBe('safety-car');
    expect(control.get(4)?.status).toBe('green');
    expect(control.get(5)?.status).toBe('green');
  });

  it('starts green when the race has no events at all', () => {
    const control = buildRaceControlByLap([1, 2], []);
    expect(control.get(1)?.status).toBe('green');
    expect(control.get(2)?.status).toBe('green');
  });

  it('tolerates a lap list that is not contiguous', () => {
    // Upstream lap numbering has gaps after a red flag, so the lap list is not
    // guaranteed to be 1..n.
    const control = buildRaceControlByLap([1, 2, 7, 8], [event(7, 'YELLOW', 'debris')]);
    expect(control.get(2)?.status).toBe('green');
    expect(control.get(7)?.status).toBe('yellow');
    expect(control.get(8)?.status).toBe('yellow');
  });
});

describe('nearestLapIndex', () => {
  it('lands on the nearest lap that exists when the asked-for one does not', () => {
    // 2025 Miami is missing laps 2-24, so ?lap=10 has no row behind it.
    expect(nearestLapIndex([1, 25, 26], 10)).toBe(0);
    expect(nearestLapIndex([1, 25, 26], 20)).toBe(1);
  });

  it('opens on lap one when there is nothing to match', () => {
    expect(nearestLapIndex([1, 2, 3], undefined)).toBe(0);
    expect(nearestLapIndex([], 5)).toBe(0);
  });

  it('keeps the first of two equally near laps rather than drifting forward', () => {
    expect(nearestLapIndex([4, 6], 5)).toBe(0);
  });
});

describe('describeMissingLaps', () => {
  it('says nothing when the record is complete', () => {
    expect(describeMissingLaps([1, 2, 3], 3)).toBeNull();
  });

  it('names a gap in the middle as a range', () => {
    const notice = describeMissingLaps([1, 25, 26], 26);
    expect(notice).toContain('laps 2–24');
    expect(notice).not.toContain('final laps');
  });

  it('names a single missing lap in the singular', () => {
    expect(describeMissingLaps([1, 3], 3)).toContain('lap 2');
  });

  it('separates several gaps', () => {
    const notice = describeMissingLaps([1, 5, 9], 9);
    expect(notice).toContain('laps 2–4');
    expect(notice).toContain('laps 6–8');
  });

  it('reports a truncated race rather than a gap', () => {
    const notice = describeMissingLaps([1, 2, 3], 58);
    expect(notice).toContain('lap 3 of 58');
    expect(notice).not.toContain('jumps over');
  });

  it('reports both a gap and a missing finish', () => {
    const notice = describeMissingLaps([1, 5], 58);
    expect(notice).toContain('laps 2–4');
    expect(notice).toContain('lap 5 of 58');
  });

  it('stays quiet with no laps at all rather than claiming the whole race is missing', () => {
    expect(describeMissingLaps([], 58)).toBeNull();
  });
});

describe('withFocusLast', () => {
  const frames = [
    { entry: entry('a', []) },
    { entry: entry('b', []) },
    { entry: entry('c', []) },
  ];
  const ids = (list: typeof frames) => list.map((f) => f.entry.driver.id);

  it('puts the focused driver last, because SVG paint order is the only z-index', () => {
    expect(ids(withFocusLast(frames, 'a'))).toEqual(['b', 'c', 'a']);
    expect(ids(withFocusLast(frames, 'c'))).toEqual(['a', 'b', 'c']);
  });

  it('leaves the order alone when nothing is focused', () => {
    expect(withFocusLast(frames, null)).toBe(frames);
  });

  it('drops nobody when the focused driver has no frame on this lap', () => {
    expect(ids(withFocusLast(frames, 'zzz'))).toEqual(['a', 'b', 'c']);
  });
});

describe('easeLapProgress', () => {
  it('starts, ends and crosses the middle exactly where linear does', () => {
    // The eased curve only changes how a car gets between two laps, never
    // which lap it is on: an endpoint that drifted would put every car in the
    // wrong place at the lap boundary.
    expect(easeLapProgress(0)).toBe(0);
    expect(easeLapProgress(1)).toBe(1);
    expect(easeLapProgress(0.5)).toBe(0.5);
  });

  it('never goes backwards', () => {
    let previous = -1;
    for (let step = 0; step <= 20; step += 1) {
      const value = easeLapProgress(step / 20);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('clamps, so a progress value past the ends cannot overshoot the lap', () => {
    expect(easeLapProgress(-0.5)).toBe(0);
    expect(easeLapProgress(1.5)).toBe(1);
  });
});
