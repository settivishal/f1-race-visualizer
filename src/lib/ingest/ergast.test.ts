import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import circuitsPayload from './__fixtures__/circuits-2025-ergast.json';
import qualifyingPage0 from './__fixtures__/qualifying-2026-ergast/page-0.json';
import qualifyingPage100 from './__fixtures__/qualifying-2026-ergast/page-100.json';
import { fetchSeasonCircuits, fetchSeasonQualifying } from './ergast';

/**
 * The circuits endpoint, against its real payload.
 *
 * `fetch` is stubbed rather than the module: what is worth testing here is the
 * envelope, and Ergast's circuits endpoint nests under a `CircuitTable` where
 * every other endpoint this client calls nests under a `RaceTable`. That
 * difference is invisible until it breaks, and it breaks at the one moment
 * nobody is watching — a seed run against a database that has no circuits yet,
 * whose emptiness fails a production build rather than a page.
 */
const originalFetch = globalThis.fetch;

// The real throttle is module state at 8 requests a minute, shared by every
// test in this file; a season fetch is three requests, so the third test would
// wait out a minute. The rate limit is not what these tests are about.
vi.mock('./throttle', () => ({
  createThrottle: () => <T>(run: () => Promise<T>) => run(),
}));

function respondWith(body: unknown, status = 200) {
  const stub = vi.fn(async (_input: URL | RequestInfo) =>
    new Response(JSON.stringify(body), { status }));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchSeasonCircuits', () => {
  it('reads the CircuitTable envelope, not the RaceTable one', async () => {
    const stub = respondWith(circuitsPayload);
    const circuits = await fetchSeasonCircuits(2025);

    expect(circuits).toHaveLength(24);
    expect(circuits[0]).toMatchObject({
      circuitId: 'albert_park',
      circuitName: 'Albert Park Grand Prix Circuit',
      Location: { locality: 'Melbourne', country: 'Australia' },
    });

    // The season belongs in the path, and the page size has to be asked for —
    // Ergast defaults to 30, which would silently drop circuits from a season
    // that has more.
    const url = new URL(String(stub.mock.calls[0][0]));
    expect(url.pathname).toBe('/ergast/f1/2025/circuits.json');
    expect(url.searchParams.get('limit')).toBe('100');
  });

  it('rejects a payload shaped like the other endpoints rather than returning nothing', async () => {
    // The failure this guards: a response that parses as JSON, carries no
    // circuits, and would otherwise seed zero rows and report success.
    respondWith({ MRData: { total: '24', RaceTable: { Races: [] } } });

    await expect(fetchSeasonCircuits(2025)).rejects.toThrow(/unrecognised envelope/);
  });

  it('gives up on a client error instead of retrying it', async () => {
    const stub = respondWith({}, 404);

    await expect(fetchSeasonCircuits(1949)).rejects.toThrow(/returned 404/);
    // 404 is not in the retryable set: a season that does not exist will not
    // start existing on the fourth attempt.
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe('fetchSeasonQualifying', () => {
  /**
   * Serves the captured 2026 pages in order, then an empty page. 2026 has 303
   * qualifying rows, so the loop asks for a third page; the empty one is what
   * upstream would return past its own data, and it has to end the loop rather
   * than spin.
   */
  function servePages(...bodies: unknown[]) {
    const stub = vi.fn(async (_input: URL | RequestInfo) =>
      new Response(JSON.stringify(bodies.shift() ?? { MRData: { total: '303', RaceTable: { Races: [] } } })));
    globalThis.fetch = stub as unknown as typeof fetch;
    return stub;
  }

  it('merges a race that the page boundary splits in two', async () => {
    servePages(qualifyingPage0, qualifyingPage100);
    const races = await fetchSeasonQualifying(2026);

    // Round 5 arrives as 15 rows at the end of the first page and 7 at the top
    // of the second. Unmerged, the second slice would either overwrite the
    // first or appear as a duplicate round. Upstream does not page in position
    // order either — P14 is on the second page — so a reader must go by
    // `position`, never by array index.
    const round5 = races.find((r) => r.round === 5);
    expect(round5?.QualifyingResults).toHaveLength(22);
    expect(round5?.QualifyingResults.map((q) => q.position).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 22 }, (_, i) => i + 1),
    );

    expect(races.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(typeof races[0].QualifyingResults[0].position).toBe('number');
  });

  it('pages with the maximum page size', async () => {
    const stub = servePages(qualifyingPage0, qualifyingPage100);
    await fetchSeasonQualifying(2026);

    const urls = stub.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0].pathname).toBe('/ergast/f1/2026/qualifying.json');
    expect(urls.map((u) => u.searchParams.get('offset'))).toEqual(['0', '100', '200']);
    expect(urls.every((u) => u.searchParams.get('limit') === '100')).toBe(true);
  });

  it('rejects an envelope with no RaceTable rather than returning no rounds', async () => {
    // An empty result is how the feature builder learns qualifying has not
    // happened yet, so a malformed answer must not look like one.
    respondWith({ MRData: { total: '0', CircuitTable: { Circuits: [] } } });

    await expect(fetchSeasonQualifying(2026)).rejects.toThrow(/unrecognised envelope/);
  });
});
