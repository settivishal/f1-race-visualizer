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
/** How long after its start a race still counts as on, for every label here. */
export const RACE_WINDOW_MINUTES = 180;

export function untilLabel(date: string, now: number): string {
  const minutes = Math.floor((Date.parse(date) - now) / 60_000);
  // Past the race window and still not imported: saying "Starting now" for
  // weeks is what a stalled import used to look like on the race list.
  if (minutes < -RACE_WINDOW_MINUTES) return 'Results pending';
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
/**
 * "2026 · Round 17", or the season alone for a cancelled round, which F1
 * leaves unnumbered. The round is the official one (`officialRound`).
 */
export const seasonRoundLabel = (season: number, round: number | null) =>
  round === null ? `${season}` : `${season} · Round ${round}`;

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

/**
 * The race the reader should see as next: the first whose start is less than
 * the race window ago, or still ahead. By the clock rather than by `status`,
 * so it moves on time whether or not the previous race has been imported yet.
 */
export function nextByClock<T extends { date: string }>(races: T[], now: number): T | null {
  const cutoff = now - RACE_WINDOW_MINUTES * 60_000;
  return (
    [...races]
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .find((race) => Date.parse(race.date) > cutoff) ?? null
  );
}

/**
 * Where the race list is in the calendar: the next race, and whether its
 * weekend has begun. From `weekendStart` (midnight at the track on the day of
 * first practice) until the race window closes it is race week; before that
 * the race is upcoming.
 */
export function weekendPhase<T extends { date: string; weekendStart: string }>(
  races: T[],
  now: number,
): { race: T; raceWeek: boolean } | null {
  const race = nextByClock(races, now);
  return race && { race, raceWeek: now >= Date.parse(race.weekendStart) };
}

type SlugRow = { slug: string; date: string; type: string; name: string };

/**
 * The grands prix either side of one, for the links at the foot of a race
 * page. `rows` is `raceSlugs`, newest first; sprints are skipped because the
 * weekend switcher already reaches them.
 */
export function adjacentGrandsPrix(rows: readonly SlugRow[], slug: string) {
  const grandsPrix = rows.filter((row) => row.type === 'GRAND_PRIX');
  const index = grandsPrix.findIndex((row) => row.slug === slug);
  if (index === -1) return { previous: null, next: null };
  return { previous: grandsPrix[index + 1] ?? null, next: grandsPrix[index - 1] ?? null };
}
