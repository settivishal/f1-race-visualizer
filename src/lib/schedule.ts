/**
 * How long until something, in words.
 *
 * Shared by the season countdown on the home page and the scheduled-race state
 * on a race page, which is the whole reason it is not a private helper of
 * either: two components saying "in 6 days" differently is how a site starts
 * to feel assembled rather than designed.
 *
 * Whole units only, largest first: "in 6 days", "in 4 hours", "in 12 minutes".
 * A race is scheduled to the minute and nobody reads seconds off a landing
 * page, so the smallest unit is the minute and "starting now" covers the hour
 * either side of a green light rather than counting down to zero and stopping.
 */
export function untilLabel(date: string, now: number): string {
  const minutes = Math.floor((Date.parse(date) - now) / 60_000);
  if (minutes < 1) return 'Starting now';

  const days = Math.floor(minutes / 1440);
  if (days >= 1) return `in ${days} ${plural(days, 'day')}`;

  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `in ${hours} ${plural(hours, 'hour')}`;

  return `in ${minutes} ${plural(minutes, 'minute')}`;
}

const plural = (n: number, unit: string) => (n === 1 ? unit : `${unit}s`);

/**
 * The one fact a race header carries after the circuit name.
 *
 * A run race has a lap count. One that has not run has `laps = 0`, and
 * printing "0 laps" reads as a broken import rather than as a race still to
 * come, so it gets its date instead, or the word that explains why it never
 * will. Shared by the page header and the share card so the two cannot drift.
 *
 * UTC, because this renders on the server into a cached page: a local
 * timezone would be the build machine's, not the reader's.
 */
export function raceHeaderFact(race: {
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  date: string;
  laps: number;
}): string {
  if (race.status === 'CANCELLED') return 'Cancelled';
  if (race.status === 'COMPLETED' && race.laps > 0) return `${race.laps} laps`;
  return new Date(race.date).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
