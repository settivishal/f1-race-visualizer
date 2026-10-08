import type { Throttle } from './throttle';

/**
 * The fetch both upstream adapters share: throttled, JSON, retried with
 * exponential backoff on the statuses that mean "try again". What differs per
 * upstream is passed in — its name for error messages, its base URL, its
 * throttle, and whether a 404 means "nothing matched".
 */

const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createJsonClient({
  name,
  baseUrl,
  throttle,
  emptyOn404 = false,
}: {
  name: string;
  baseUrl: string;
  throttle: Throttle;
  /** Answer a 404 with an empty list instead of failing. */
  emptyOn404?: boolean;
}) {
  return async function get(path: string, params: Record<string, string | number>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await throttle(() => fetch(url, { headers: { accept: 'application/json' } }));
      if (response.ok) return response.json();
      if (response.status === 404 && emptyOn404) return [];

      lastError = new Error(`${name} ${path} returned ${response.status}`);
      if (!RETRYABLE.has(response.status)) throw lastError;

      // Exponential backoff. A 429 means the throttle's view of the window and
      // the server's have drifted, so waiting longer than the gap is the point.
      if (attempt < MAX_ATTEMPTS) await sleep(2 ** attempt * 1000);
    }
    throw lastError;
  };
}
