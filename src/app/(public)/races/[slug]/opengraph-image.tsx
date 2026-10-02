import { ImageResponse } from 'next/og';
import { getRaceHeader } from '@/lib/queries';
import { sessionTitle } from '@/lib/session-title';
import { raceHeaderFact } from '@/lib/schedule';

/**
 * The share card for a race.
 *
 * Drawn rather than screenshotted: the replay is a canvas and a still frame of
 * it says nothing, so the card carries the things a link needs to answer —
 * which race, which season, which circuit. Colours are the dark-theme tokens
 * hard-coded, because Satori resolves no CSS variables and no stylesheet.
 *
 * `getRaceHeader` is the same cached read the page uses, so a card costs no
 * query of its own, and the route is prerendered alongside the page.
 */
export const alt = 'Race replay';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { race } = await getRaceHeader(slug);

  const meeting = race?.meeting;
  // Named like the page it illustrates: the sprint's card should not share a
  // headline with the grand prix it shares a weekend with.
  const title = meeting && race ? sessionTitle(meeting.name, race.type) : (meeting?.name ?? slug);

  // Satori requires an explicit display on any element with more than one
  // child, and adjacent expressions count as several. Building each line as one
  // string keeps every node single-child and the styles honest.
  const eyebrow = meeting
    ? [`${meeting.season}`, `ROUND ${meeting.round}`, race?.type === 'SPRINT' ? 'SPRINT' : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  const subtitle = [
    meeting?.circuitName ?? meeting?.country ?? '',
    race ? raceHeaderFact(race) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#07080b',
          color: '#f3f5f8',
          padding: 80,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 12, height: 56, borderRadius: 6, background: '#ff2016' }} />
          <div style={{ fontSize: 30, letterSpacing: 6, textTransform: 'uppercase' }}>
            RaceLines
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {eyebrow ? (
            <div style={{ fontSize: 32, color: '#ff2016', letterSpacing: 4 }}>{eyebrow}</div>
          ) : null}
          <div style={{ fontSize: 84, fontWeight: 700, marginTop: 16, lineHeight: 1.1 }}>
            {title}
          </div>
          <div style={{ fontSize: 34, color: '#9aa4b4', marginTop: 20 }}>{subtitle}</div>
        </div>

        <div style={{ fontSize: 28, color: '#9aa4b4' }}>
          Every position change, lap by lap.
        </div>
      </div>
    ),
    size,
  );
}
