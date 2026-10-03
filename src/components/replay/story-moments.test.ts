import { describe, expect, it } from 'vitest';
import { clusterMoments, timelineTicks } from './race-story-timeline';
import {
  activeMomentAt, buildStoryMoments, describeMoment, significanceOf, type StoryMoment,
} from './story-moments';
import type { ReplayView } from './types';

describe('describeMoment', () => {
  it('names the signal, not the enum', () => {
    expect(describeMoment('safety-car', null)).toBe('Safety car');
    expect(describeMoment('red-flag', null)).toBe('Red flag');
    expect(describeMoment('chequered', null)).toBe('Chequered flag');
  });

  it('names the driver where there is one, and stays readable where there is not', () => {
    expect(describeMoment('pit', 'NOR')).toBe('NOR pits');
    expect(describeMoment('pit', null)).toBe('Pit stop');
    expect(describeMoment('dnf', 'HUL')).toBe('HUL retires');
    expect(describeMoment('dnf', null)).toBe('Retirement');
    expect(describeMoment('penalty', 'PIA')).toBe('PIA penalised');
  });

  it('never puts the lap in the title, which is rendered separately', () => {
    for (const kind of ['pit', 'dnf', 'safety-car', 'other'] as const) {
      expect(describeMoment(kind, 'VER')).not.toMatch(/lap/i);
    }
  });
});

// Only the fields buildStoryMoments reads. The generated ReplayView carries
// more, and filling it in would test the fixture rather than the function.
function view(partial: {
  events?: { lap: number; type: string; details: string; driver?: { id: string; code: string; name: string; number: number } | null }[];
  drivers?: { id: string; code: string; name: string; positions: { lap: number; position: number }[] }[];
}): ReplayView {
  return {
    events: partial.events ?? [],
    drivers: (partial.drivers ?? []).map((entry) => ({
      driver: { id: entry.id, code: entry.code, name: entry.name },
      positions: entry.positions,
    })),
  } as unknown as ReplayView;
}

describe('buildStoryMoments', () => {
  it('classifies from the details, not only the type', () => {
    // Upstream files a red flag as type OTHER often enough that reading the
    // type alone would render it as a generic event.
    const [moment] = buildStoryMoments(
      view({ events: [{ lap: 5, type: 'OTHER', details: 'Red flag deployed' }] }),
    );
    expect(moment.title).toBe('Red flag');
    expect(moment.eventKind).toBe('red-flag');
    expect(moment.kind).toBe('control');
  });

  it('reads the archive event types that carry no keyword in their details', () => {
    // Ergast files these as "P17 to P16" and "1:24.125" — nothing in the text
    // says what they are, so the type is the only signal.
    const [overtake] = buildStoryMoments(
      view({
        events: [{
          lap: 2, type: 'OVERTAKE', details: 'P17 to P16',
          driver: { id: 'd1', code: 'GAS', name: 'Pierre Gasly', number: 10 },
        }],
      }),
    );
    expect(overtake).toMatchObject({ title: 'GAS moves up', kind: 'overtake', eventKind: 'overtake' });

    const [fastest] = buildStoryMoments(
      view({
        events: [{
          lap: 44, type: 'FASTEST_LAP', details: '1:24.125',
          driver: { id: 'd2', code: 'VER', name: 'Max Verstappen', number: 1 },
        }],
      }),
    );
    expect(fastest.title).toBe('VER sets the fastest lap');
  });

  it('separates a pit stop from race control, which is what the filters ask', () => {
    const [moment] = buildStoryMoments(
      view({
        events: [{
          lap: 12, type: 'PIT_STOP', details: 'Box',
          driver: { id: 'd1', code: 'NOR', name: 'Lando Norris', number: 4 },
        }],
      }),
    );
    expect(moment).toMatchObject({ title: 'NOR pits', kind: 'strategy', lap: 12 });
    expect(moment.description).toContain('Lando Norris');
  });

  it('derives a moment from a gain of two places, and ignores one', () => {
    const moments = buildStoryMoments(
      view({
        drivers: [{
          id: 'd1', code: 'LEC', name: 'Charles Leclerc',
          positions: [
            { lap: 1, position: 8 },
            { lap: 2, position: 7 },  // one place: traffic, not a move
            { lap: 3, position: 4 },  // three places
          ],
        }],
      }),
    );
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ lap: 3, title: 'LEC gains 3 places', kind: 'overtake' });
  });

  it('keeps the derived gain and drops the archive overtake for the same move', () => {
    const moments = buildStoryMoments(
      view({
        events: [{
          lap: 3, type: 'OVERTAKE', details: 'P8 to P4',
          driver: { id: 'd1', code: 'LEC', name: 'Charles Leclerc', number: 16 },
        }],
        drivers: [{
          id: 'd1', code: 'LEC', name: 'Charles Leclerc',
          positions: [{ lap: 1, position: 8 }, { lap: 3, position: 4 }],
        }],
      }),
    );
    expect(moments.map((moment) => moment.title)).toEqual(['LEC gains 4 places']);
  });

  it('orders by lap and drops a message repeated on the same lap', () => {
    const moments = buildStoryMoments(
      view({
        events: [
          { lap: 9, type: 'SAFETY_CAR', details: 'Safety car deployed' },
          { lap: 2, type: 'SAFETY_CAR', details: 'Safety car deployed' },
          { lap: 9, type: 'SAFETY_CAR', details: 'Safety car deployed' },
        ],
      }),
    );
    expect(moments.map((moment) => moment.lap)).toEqual([2, 9]);
  });
});

describe('significanceOf', () => {
  it('keeps what changed the race', () => {
    const major = buildStoryMoments(
      view({
        events: [
          { lap: 5, type: 'SAFETY_CAR', details: 'Safety car deployed' },
          { lap: 9, type: 'RETIREMENT', details: 'Engine' },
          { lap: 12, type: 'PIT_STOP', details: 'Box' },
          { lap: 44, type: 'FASTEST_LAP', details: '1:24.125' },
        ],
      }),
    );
    expect(major.map(significanceOf)).toEqual(['major', 'major', 'major', 'major']);
  });

  it('sets aside the per-position overtakes that make up most of a race', () => {
    const [overtake] = buildStoryMoments(
      view({
        events: [{
          lap: 2, type: 'OVERTAKE', details: 'P17 to P16',
          driver: { id: 'd9', code: 'GAS', name: 'Pierre Gasly', number: 10 },
        }],
      }),
    );
    expect(significanceOf(overtake)).toBe('minor');
  });

  it('judges a derived gain by how far through the field it went', () => {
    const moments = buildStoryMoments(
      view({
        drivers: [{
          id: 'd1', code: 'LEC', name: 'Charles Leclerc',
          positions: [
            { lap: 1, position: 10 },
            { lap: 2, position: 8 },   // two places
            { lap: 3, position: 4 },   // four places
          ],
        }],
      }),
    );
    // Both are moments; only the four-place move is a key one. The derived
    // gains carry eventKind "overtake" for colour, so this also pins that the
    // place count is read before that shortcut.
    expect(moments.map((moment) => [moment.places, significanceOf(moment)]))
      .toEqual([[2, 'minor'], [4, 'major']]);
  });
});

describe('activeMomentAt', () => {
  const moments = [
    { id: 'a', lap: 2 },
    { id: 'b', lap: 9 },
    { id: 'c', lap: 20 },
  ] as StoryMoment[];

  it('is the last moment at or before the lap', () => {
    expect(activeMomentAt(moments, 9)?.id).toBe('b');
    expect(activeMomentAt(moments, 19)?.id).toBe('b');
    expect(activeMomentAt(moments, 20)?.id).toBe('c');
  });

  it('is null before the first moment rather than showing a future one', () => {
    expect(activeMomentAt(moments, 1)).toBeNull();
    expect(activeMomentAt([], 40)).toBeNull();
  });
});

describe('clusterMoments', () => {
  const at = (lap: number, id: string) => ({ id, lap }) as StoryMoment;

  // Every case states the rail width it is about. That is the whole point of
  // the change: how close two markers may be is a question about pixels, and
  // the same percentage means different things on a phone and a monitor.
  //
  // 740 is roughly what the rail gets on a full-width desktop page — the
  // container is max-w-6xl less the timing tower and the padding — not the
  // whole viewport.
  const DESKTOP = 740;
  const PHONE = 360;

  it('merges everything on one lap, and the lap beside it when they touch', () => {
    // A safety car and the two stops it triggers, all on lap 30 of 60. On a
    // 740px rail consecutive laps are 12px apart — closer than the marker drawn
    // on them — so lap 31 joins them.
    const clusters = clusterMoments([at(30, 'a'), at(30, 'b'), at(31, 'c')], 1, 60, DESKTOP);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].moments).toHaveLength(3);
  });

  it('merges more on a phone than on a desktop, for the same race', () => {
    // Three laps apart on a 60-lap race: 38px on the desktop rail, two
    // comfortable targets — and 18px on a phone, which is one. Identical data,
    // and the right answer differs, which a percentage could never express.
    const pair = [at(30, 'a'), at(33, 'b')];
    expect(clusterMoments(pair, 1, 60, DESKTOP)).toHaveLength(2);
    expect(clusterMoments(pair, 1, 60, PHONE)).toHaveLength(1);
  });

  it('keeps markers far enough apart as separate targets', () => {
    const clusters = clusterMoments([at(5, 'a'), at(40, 'b')], 1, 60, DESKTOP);
    expect(clusters.map((cluster) => cluster.lap)).toEqual([5, 40]);
    expect(clusters[0].offset).toBeCloseTo((4 / 59) * 100);
  });

  it('does not divide by zero on a race with one lap', () => {
    expect(clusterMoments([at(1, 'a')], 1, 1, DESKTOP)[0].offset).toBe(0);
  });
});

describe('timelineTicks', () => {
  it('labels every 10 laps, and the last lap without crowding it', () => {
    // 50 is three laps from 53: under half a step, so it would collide.
    expect(timelineTicks(1, 53)).toEqual([1, 10, 20, 30, 40, 53]);
    expect(timelineTicks(1, 58)).toEqual([1, 10, 20, 30, 40, 50, 58]);
  });

  it('labels every 5 laps in a sprint', () => {
    expect(timelineTicks(1, 19)).toEqual([1, 5, 10, 15, 19]);
  });

  it('does not repeat a one-lap race', () => {
    expect(timelineTicks(1, 1)).toEqual([1]);
  });
});
