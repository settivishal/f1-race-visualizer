import Link from 'next/link';
import { CountUp } from '@/components/home/count-up';
import { Card } from '@/components/ui/card';
import { formatPoints, isTitleSettled, pointsStillAvailable, type RemainingRounds } from '@/lib/championship';

/**
 * The title race, as a sentence rather than a table.
 *
 * The standings below already list twenty drivers in order. What that view does
 * not say is the only thing most people want: how far ahead the leader is, and
 * whether it is over. The arithmetic lives in lib/championship.ts with its own
 * test, because a site that says "mathematically settled" had better be right.
 */

export type Contender = {
  code: string;
  name: string;
  points: number;
  teamColor: string | null;
};

export function ChampionshipFight({
  season,
  leader,
  second,
  remaining,
}: {
  season: number;
  leader: Contender;
  second: Contender | null;
  remaining: RemainingRounds;
}) {
  const gap = second ? leader.points - second.points : leader.points;
  const available = pointsStillAvailable(remaining);
  const settled = second ? isTitleSettled(gap, remaining) : true;
  const roundsLeft = remaining.grandsPrix;

  return (
    <section className="reveal mt-14">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-eyebrow font-bold uppercase text-muted">The title race</h2>
        <Link
          href={`/standings?season=${season}`}
          className="rounded-sm text-sm font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Full standings
        </Link>
      </div>

      <Card className="mt-3 p-7">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
          <Contender contender={leader} label="Leader" />
          {second ? (
            <>
              <p className="tabular text-center">
                {/* The one number on the page worth watching arrive. It renders
                    as its final value, so the server output and a reader with
                    no JavaScript both get the answer. */}
                <span className="block type-page-title text-accent">
                  +<CountUp value={gap} />
                </span>
                <span className="text-eyebrow font-semibold uppercase text-muted">points</span>
              </p>
              <Contender contender={second} label="Second" />
            </>
          ) : null}
        </div>

        <p className="mt-6 text-sm leading-6 text-muted">
          {roundsLeft === 0 ? (
            <>The season is over. {leader.name} finished on {formatPoints(leader.points)} points.</>
          ) : settled ? (
            <>
              Settled: {formatPoints(gap)} points clear with {formatPoints(available)} still to
              race for.
            </>
          ) : (
            <>
              {`${roundsLeft} ${roundsLeft === 1 ? 'round' : 'rounds'} left`}
              {remaining.sprints > 0
                ? `, ${remaining.sprints} with a sprint`
                : ''}
              {' — '}
              {formatPoints(available)} points still available, so the gap of{' '}
              {formatPoints(gap)} is not yet decisive.
            </>
          )}
        </p>
      </Card>
    </section>
  );
}

function Contender({ contender, label }: { contender: Contender; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="h-10 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: contender.teamColor ?? 'var(--muted)' }}
        aria-hidden
      />
      <div>
        <p className="text-eyebrow font-semibold uppercase text-subtle">{label}</p>
        <p className="type-card-title mt-0.5">{contender.name}</p>
        <p className="tabular text-sm text-muted">{formatPoints(contender.points)} points</p>
      </div>
    </div>
  );
}
