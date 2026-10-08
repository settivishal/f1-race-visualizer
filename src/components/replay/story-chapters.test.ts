import { describe, expect, it } from 'vitest';
import { MAX_CHAPTERS, buildStoryChapters } from './story-chapters';
import type { ReplayView } from './types';

type Event = { lap: number; type: string; details: string; driver?: { id: string; code: string; name: string } | null };

// Only what buildStoryChapters reads; see the fixture note in story-moments.test.ts.
function view(laps: number, events: Event[], order: string[] = ['VER', 'NOR']): ReplayView {
  const lapList = Array.from({ length: laps }, (_, index) => index + 1);
  return {
    laps: lapList,
    events,
    drivers: order.map((code, index) => ({
      driver: { id: code, code, name: `Driver ${code}` },
      positions: lapList.map((lap) => ({ lap, position: index + 1 })),
    })),
  } as unknown as ReplayView;
}

describe('buildStoryChapters', () => {
  it('opens on the first lap and closes on the last, naming the leader and the winner', () => {
    const chapters = buildStoryChapters(view(50, []));
    expect(chapters.map((chapter) => [chapter.lap, chapter.title])).toEqual([
      [1, 'Lights out'],
      [50, 'Chequered flag'],
    ]);
    expect(chapters[1].lines).toEqual(['Driver VER wins.']);
    expect(chapters[1].driverId).toBe('VER');
  });

  it('leaves pit stops out and groups one lap into one chapter', () => {
    const chapters = buildStoryChapters(
      view(50, [
        { lap: 10, type: 'PIT', details: 'Pit stop', driver: { id: 'NOR', code: 'NOR', name: 'Lando Norris' } },
        { lap: 20, type: 'OTHER', details: 'Safety car deployed' },
        { lap: 20, type: 'RETIREMENT', details: 'Collision', driver: { id: 'NOR', code: 'NOR', name: 'Lando Norris' } },
      ]),
    );
    expect(chapters.map((chapter) => chapter.lap)).toEqual([1, 20, 50]);
    expect(chapters[1].title).toBe('Safety car');
    expect(chapters[1].lines).toHaveLength(2);
  });

  it('keeps the biggest moments of a busy race, in lap order', () => {
    const events: Event[] = Array.from({ length: 20 }, (_, index) => ({
      lap: index + 2,
      type: 'OTHER',
      details: 'Yellow flag in sector 2',
    }));
    events.push({ lap: 40, type: 'OTHER', details: 'Red flag' });
    const chapters = buildStoryChapters(view(50, events));

    expect(chapters).toHaveLength(MAX_CHAPTERS);
    expect(chapters.some((chapter) => chapter.title === 'Red flag')).toBe(true);
    const laps = chapters.map((chapter) => chapter.lap);
    expect(laps).toEqual([...laps].sort((a, b) => a - b));
  });
});
