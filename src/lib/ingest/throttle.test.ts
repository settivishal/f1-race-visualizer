import { describe, expect, it, vi, afterEach } from 'vitest';
import { createThrottle } from './throttle';

afterEach(() => vi.useRealTimers());

describe('createThrottle', () => {
  it('paces calls and never exceeds the per-minute ceiling', async () => {
    vi.useFakeTimers();
    const throttle = createThrottle({ perSecond: 3, perMinute: 30 });

    const startedAt: number[] = [];
    const calls = Array.from({ length: 40 }, () =>
      throttle(async () => {
        startedAt.push(Date.now());
      }),
    );

    await vi.runAllTimersAsync();
    await Promise.all(calls);

    expect(startedAt).toHaveLength(40);

    // No rolling 60s window may contain more than 30 starts.
    for (let i = 0; i + 30 < startedAt.length; i++) {
      expect(startedAt[i + 30] - startedAt[i]).toBeGreaterThanOrEqual(60_000);
    }

    // Consecutive calls are at least 1/3 of a second apart.
    for (let i = 1; i < startedAt.length; i++) {
      expect(startedAt[i] - startedAt[i - 1]).toBeGreaterThanOrEqual(1000 / 3);
    }

    // 40 calls at 30/minute cannot finish inside one minute.
    expect(startedAt[startedAt.length - 1] - startedAt[0]).toBeGreaterThan(60_000);
  });

  it('keeps running after a call rejects', async () => {
    vi.useFakeTimers();
    const throttle = createThrottle({ perSecond: 3, perMinute: 30 });

    const failed = throttle(async () => {
      throw new Error('boom');
    });
    const after = throttle(async () => 'ok');

    await vi.runAllTimersAsync();

    await expect(failed).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
  });
});
