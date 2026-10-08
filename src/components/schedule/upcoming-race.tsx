'use client';

import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { untilLabel, weekendPhase } from '@/lib/schedule';
import { useNow } from '@/lib/use-now';

/**
 * A race that has not been run yet.
 *
 * The site now stores the whole calendar, not only the races it has data for —
 * that is what gives the season progress bar its denominator and the countdown
 * something to count towards. A race with `laps === 0` is one of those: the
 * schedule exists, the result does not.
 *
 * `laps === 0` is the signal rather than "the date is in the future", because
 * these render inside `use cache` scopes with a day's life. A comparison
 * against the server's clock would be baked into the cache entry and go stale;
 * the lap count is a fact about the data and cannot.
 *
 * Client components, because the one thing a schedule must get right is the
 * reader's own timezone. The server does not know it, and a cached page could
 * not vary by it even if it did.
 */

/**
 * The start time in the reader's timezone, with the countdown beside it.
 *
 * Renders the UTC date on the server and before hydration, so the card is never
 * blank and never lies — it simply gets more useful once the browser says where
 * it is.
 */
export function RaceStartTime({ date }: { date: string }) {
  const now = useNow();
  const start = new Date(date);

  if (now === 0) {
    return (
      <span className="tabular">
        {start.toISOString().slice(0, 10)} · {start.toISOString().slice(11, 16)} UTC
      </span>
    );
  }

  return (
    <span className="tabular">
      {start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ·{' '}
      {start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      <span className="text-subtle"> · {untilLabel(date, now)}</span>
    </span>
  );
}

type Scheduled = { slug: string; date: string; weekendStart: string };

/**
 * The race list's marker for where the season is, by the reader's clock: the
 * next race reads "Upcoming", or "Race Week" once its weekend has begun at the
 * track. Nothing before the clock arrives, because a cached page cannot know
 * which of the two it is.
 *
 * ponytail: picks among the races on screen, so a search that hides the true
 * next race badges a later one. Pass the full season list if that matters.
 */
export function WeekendBadge({ slug, scheduled }: { slug: string; scheduled: Scheduled[] }) {
  const now = useNow();
  const phase = now === 0 ? null : weekendPhase(scheduled, now);
  if (phase?.race.slug !== slug) return null;
  return <Badge tone="accent">{phase.raceWeek ? 'Race Week' : 'Upcoming'}</Badge>;
}

/**
 * The card's frame, which glows during race week and only then: in the gap
 * between weekends nothing on the list is happening, so nothing is lit.
 * `data-race-week` lets the card inside pick up the accent border.
 */
export function RaceWeekFrame({
  slug,
  scheduled,
  className,
  children,
}: {
  slug: string;
  scheduled: Scheduled[];
  className: string;
  children: ReactNode;
}) {
  const now = useNow();
  const phase = now === 0 ? null : weekendPhase(scheduled, now);
  const lit = phase?.raceWeek === true && phase.race.slug === slug;
  return (
    <div data-race-week={lit || undefined} className={`${className} ${lit ? 'shadow-glow' : ''}`}>
      {children}
    </div>
  );
}

/**
 * The race page's replay area, when there is nothing to replay.
 *
 * Two reasons for that, and they must not read the same. A scheduled race
 * counts down. A cancelled one says so and stops — the two 2026 rounds
 * abandoned in April were, before this, counting down to a date months past.
 */
export function UpcomingRace({
  date,
  name,
  cancelled = false,
}: {
  date: string;
  name: string;
  cancelled?: boolean;
}) {
  const now = useNow();
  const start = new Date(date);
  const known = now !== 0;

  if (cancelled) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
        <p className="text-eyebrow font-bold uppercase text-flag-red">Cancelled</p>
        <p className="type-section-title mt-3">This race was not held</p>
        <p className="mt-3 text-sm text-muted">
          {name} was scheduled for{' '}
          <span className="tabular text-foreground">
            {start.toISOString().slice(0, 10)}
          </span>{' '}
          and did not take place. It keeps its round so the season reads as it
          was planned.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-line bg-panel px-6 py-12 text-center">
      <p className="text-eyebrow font-bold uppercase text-accent">Not yet run</p>
      <p className="type-section-title mt-3">
        {known ? untilLabel(date, now) : 'Scheduled'}
      </p>
      <p className="mt-3 text-sm text-muted">
        {name} starts{' '}
        <span className="tabular text-foreground">
          {known
            ? `${start.toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}, ${start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
            : `${start.toISOString().slice(0, 10)} ${start.toISOString().slice(11, 16)} UTC`}
        </span>
        {known ? <span className="text-subtle"> your time</span> : null}.
      </p>
      <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted">
        The replay is built from lap-by-lap position data, which is published after
        the race. This page will fill in once it has been imported.
      </p>
    </div>
  );
}
