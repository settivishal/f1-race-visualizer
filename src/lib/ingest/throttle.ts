/**
 * A shared rate limiter for the OpenF1 client.
 *
 * OpenF1's free tier allows 3 requests/second and 30 requests/minute. Both
 * ceilings have to hold at once: pacing alone would allow 180 requests in a
 * minute, and a per-minute cap alone would allow 30 at once.
 *
 * This lives here rather than in the callers deliberately. A backfill that
 * sleeps between its own requests makes respecting the limit something every
 * future caller has to remember, and the first one who forgets breaches it.
 */
export type Throttle = <T>(fn: () => Promise<T>) => Promise<T>;

export function createThrottle({
  perSecond,
  perMinute,
}: {
  perSecond: number;
  perMinute: number;
}): Throttle {
  // Whole milliseconds, rounded up. A fractional gap can round down to a 0ms
  // timer, which never advances the clock and spins the wait loop forever.
  const minGapMs = Math.ceil(1000 / perSecond);
  // Completion times of recent calls, oldest first, pruned to the last minute.
  const recent: number[] = [];
  // The tail of the queue. Each call chains onto the previous one, so calls
  // run in order and never overlap.
  let tail: Promise<unknown> = Promise.resolve();

  async function waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (recent.length > 0 && now - recent[0] >= 60_000) recent.shift();

      const sinceLast = recent.length > 0 ? now - recent[recent.length - 1] : Infinity;
      const gapWait = sinceLast >= minGapMs ? 0 : minGapMs - sinceLast;

      // The oldest call in the window has to age out before another can start.
      const windowWait = recent.length < perMinute ? 0 : 60_000 - (now - recent[0]);

      const wait = Math.ceil(Math.max(gapWait, windowWait));
      if (wait <= 0) {
        recent.push(now);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  return function run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => {
      await waitForSlot();
      return fn();
    });
    // Keep the chain going even when a call rejects, or one failure would
    // wedge every request queued behind it.
    tail = result.catch(() => undefined);
    return result;
  };
}
