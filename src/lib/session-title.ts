/**
 * What to call a session.
 *
 * A meeting is named for its grand prix — "British Grand Prix" — and both of a
 * weekend's sessions inherited that name, so the sprint page's heading said
 * "British Grand Prix" and relied on a badge beside it to say otherwise. A
 * heading that needs a pill to correct it is the wrong heading: the sprint is
 * the British Sprint.
 *
 * The substitution is on the trailing words only. "Grand Prix" appears in every
 * meeting name in the archive, and a replacement anywhere in the string would
 * mangle a name that happened to contain it elsewhere.
 */
export function sessionTitle(meetingName: string, type: 'GRAND_PRIX' | 'SPRINT'): string {
  if (type !== 'SPRINT') return meetingName;
  const renamed = meetingName.replace(/\s*grand prix\s*$/i, ' Sprint');
  // A meeting whose name does not end that way — Ergast has a few — keeps its
  // name and gains the word, rather than silently reading as a grand prix.
  return renamed === meetingName ? `${meetingName} Sprint` : renamed.trim();
}

/** A race's title, or its slug for a race with no meeting to name it. */
export function raceTitle(race: {
  slug: string;
  type: 'GRAND_PRIX' | 'SPRINT';
  meeting?: { name: string } | null;
}): string {
  return race.meeting ? sessionTitle(race.meeting.name, race.type) : race.slug;
}

/** The kind of session, as a label. */
export const sessionLabel = (type: 'GRAND_PRIX' | 'SPRINT') => (type === 'SPRINT' ? 'Sprint' : 'Grand Prix');
