import { describe, expect, it } from 'vitest';
import {
  buildDriverReplayState,
  buildRaceControlByLap,
  classifyReplayEvent,
  summarizeDriverReplayState,
} from './replay-state';
import type { ReplayEntry, ReplayEvent, ReplayPosition } from './types';

function position(lap: number, pos: number, gap: string | null = null): ReplayPosition {
  return { lap, position: pos, gap, lapTime: null, sector1: null, sector2: null, sector3: null };
}

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

describe('buildDriverReplayState', () => {
  it('holds the last known position for a driver missing from the current lap', () => {
    // The reason this matters: lap rows are not guaranteed for every driver on
    // every lap. Dropping the driver would make a car vanish mid-replay.
    const states = buildDriverReplayState(
      [entry('a', [position(1, 1, 'LEADER'), position(5, 3, '+12.0s')])],
      3,
    );

    expect(states.get('a')?.gapLabel).toBe('LEADER');
  });

  it('reads a lapped driver out of the gap string', () => {
    const states = buildDriverReplayState([entry('a', [position(1, 12, '2 laps')])], 1);
    const state = states.get('a');

    expect(state?.isLapped).toBe(true);
    expect(state?.lapsDown).toBe(2);
    expect(state?.statusLabel).toBe('2 laps down');
  });

  it('marks a retired driver retired rather than lapped', () => {
    const states = buildDriverReplayState([entry('a', [position(1, 20, 'DNF')])], 1);
    const state = states.get('a');

    expect(state?.isRetired).toBe(true);
    expect(state?.isBackmarker).toBe(false);
    expect(state?.statusLabel).toBe('Retired');
  });

  it('treats a driver far behind as a backmarker without lapping them', () => {
    const states = buildDriverReplayState([entry('a', [position(1, 18, '+90.5s')])], 1);
    const state = states.get('a');

    expect(state?.isBackmarker).toBe(true);
    expect(state?.isLapped).toBe(false);
    expect(state?.statusLabel).toBe('Backmarker');
  });

  it('leaves a driver on the lead lap unlabelled', () => {
    const states = buildDriverReplayState([entry('a', [position(1, 1, 'LEADER')])], 1);
    expect(states.get('a')?.statusLabel).toBeNull();
  });
});

describe('summarizeDriverReplayState', () => {
  it('counts each condition independently', () => {
    const states = buildDriverReplayState(
      [
        entry('a', [position(1, 1, 'LEADER')]),
        entry('b', [position(1, 12, '1 lap')]),
        entry('c', [position(1, 20, 'DNF')]),
      ],
      1,
    );

    // The lapped driver is also a backmarker; the retired one is neither.
    expect(summarizeDriverReplayState(states)).toEqual({
      lappedCount: 1,
      backmarkerCount: 1,
      retiredCount: 1,
    });
  });
});
