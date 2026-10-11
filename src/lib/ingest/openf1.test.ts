import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSessionByKey, toQualifying } from './openf1';

/**
 * `fetchSessionByKey` exists because of a bug worth not repeating.
 *
 * Resolving a session used to mean fetching whole seasons from a hardcoded
 * list of years — `[2025, 2024, 2023]` — and filtering for the key. It worked
 * until the calendar moved past the list, and then every import of a 2026 race
 * failed with "session not found" while the API had the data all along. The
 * cron would have hit the same wall in March and reported nothing wrong.
 *
 * So the one thing to pin is that the key reaches the query string, and that
 * a year is not part of the lookup.
 */
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const session = {
  session_key: 11361,
  session_type: 'Race',
  session_name: 'Race',
  date_start: '2026-09-06T13:00:00+00:00',
  date_end: '2026-09-06T15:00:00+00:00',
  meeting_key: 1293,
  year: 2026,
  circuit_short_name: 'Monza',
  country_name: 'Italy',
};

describe('fetchSessionByKey', () => {
  it('asks for the session by key, with no year in the request', async () => {
    const stub = vi.fn(async (_input: URL | RequestInfo) =>
      new Response(JSON.stringify([session]), { status: 200 }));
    globalThis.fetch = stub as unknown as typeof fetch;

    const [found] = await fetchSessionByKey(11361);
    expect(found.session_key).toBe(11361);

    const url = new URL(String(stub.mock.calls[0][0]));
    expect(url.pathname).toContain('/sessions');
    expect(url.searchParams.get('session_key')).toBe('11361');
    // The whole point: nothing here is scoped to a year, so a season the code
    // has never heard of resolves like any other.
    expect(url.searchParams.get('year')).toBeNull();
  });

  it('returns nothing for a key that does not exist, rather than throwing', async () => {
    globalThis.fetch = (async () =>
      new Response('[]', { status: 200 })) as unknown as typeof fetch;

    // run.ts turns the empty result into its own "session not found", which is
    // the message that carries the session key.
    await expect(fetchSessionByKey(1)).resolves.toEqual([]);
  });
});

describe('toQualifying', () => {
  it('joins results to drivers by car number and keeps a missing time as null', () => {
    const result = (driver_number: number, position: number | null) =>
      ({ driver_number, position, number_of_laps: null, points: null, dnf: false, dns: false, dsq: false });
    const driver = (driver_number: number, name_acronym: string, team_name: string) =>
      ({ driver_number, name_acronym, full_name: name_acronym, team_name, team_colour: null, headshot_url: null, country_code: null });

    expect(toQualifying(
      [result(3, 1), result(44, null)],
      [driver(44, 'HAM', 'Ferrari'), driver(3, 'VER', 'Red Bull Racing')],
    )).toEqual([
      { code: 'VER', teamName: 'Red Bull Racing', position: 1 },
      { code: 'HAM', teamName: 'Ferrari', position: null },
    ]);
  });
});
