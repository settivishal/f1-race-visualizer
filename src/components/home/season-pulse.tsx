import Link from 'next/link';
import { inkOn, teamMonogram } from '@/lib/team-monogram';

/**
 * The season as a row of dots, one per round, in the winning team's colour.
 *
 * A standings table says who is ahead; this says how the season went — three
 * silver rounds then five red ones is a story you can read without knowing a
 * single number. Rounds not yet run are hollow, so the strip also shows how much
 * season is left.
 *
 * Grands prix only: a sprint is a session inside a round, and counting it would
 * make a twenty-four race season render thirty-one dots.
 */

export type PulseRound = {
  round: number;
  name: string;
  slug: string | null;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  winnerCode: string | null;
  teamName: string | null;
  teamColor: string | null;
};

export function SeasonPulse({ season, rounds }: { season: number; rounds: PulseRound[] }) {
  if (rounds.length === 0) return null;

  // No "n of m run" here: the season card above owns that count. This one
  // counted imported results and that one counted dates, so the two disagreed
  // whenever an import lagged a race.
  return (
    <section className="reveal mt-14">
      <h2 className="text-eyebrow font-bold uppercase text-muted">{season} at a glance</h2>

      <ol className="mt-4 flex flex-wrap gap-1.5">
        {rounds.map((round, index) => {
          const label =
            round.status === 'CANCELLED'
              ? `Round ${round.round}, ${round.name}: cancelled`
              : round.winnerCode
                ? `Round ${round.round}, ${round.name}: won by ${round.winnerCode}`
                : `Round ${round.round}, ${round.name}: not yet run`;

          const monogram = round.winnerCode ? teamMonogram(round.teamName) : null;

          const dot = (
            <span
              className={`relative block h-9 w-9 rounded-lg border transition-transform ${
                round.winnerCode
                  ? 'border-transparent group-hover:scale-110'
                  : 'border-dashed border-line'
              }`}
              style={
                round.winnerCode
                  ? { backgroundColor: round.teamColor ?? 'var(--muted)' }
                  : undefined
              }
              aria-hidden
            >
              {/* Who won it, on their own colour. The colour still does the
                  distance work — a season reads as a run of reds or silvers
                  from across the room — and the monogram answers the question
                  the colour cannot: which red. */}
              {monogram ? (
                <span
                  className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold tracking-tight"
                  style={{ color: inkOn(round.teamColor) }}
                >
                  {monogram}
                </span>
              ) : null}
              {/* A cancelled round keeps its place, struck through: the season
                  did schedule it, and a calendar that hides it never existed. */}
              {round.status === 'CANCELLED' ? (
                <span className="absolute left-1 right-1 top-1/2 h-px -translate-y-1/2 rotate-45 bg-flag-red" />
              ) : null}
            </span>
          );

          return (
            // Each round arrives just after the one before it, so the strip
            // reads left to right the way the season ran. Scroll-driven like
            // every other entrance here, so it happens when the strip is
            // looked at rather than while it is off screen.
            <li
              key={round.round}
              className="pulse-pill"
              style={{ '--i': index } as React.CSSProperties}
            >
              {round.slug ? (
                <Link href={`/races/${round.slug}`} className="group block rounded-lg" title={label}>
                  <span className="sr-only">{label}</span>
                  {dot}
                </Link>
              ) : (
                <span className="block" title={label}>
                  <span className="sr-only">{label}</span>
                  {dot}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
