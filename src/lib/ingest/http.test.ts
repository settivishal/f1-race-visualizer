import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJsonClient } from './http';

const originalFetch = globalThis.fetch;
const passthrough = <T>(run: () => Promise<T>) => run();

function respondInTurn(...statuses: number[]) {
  const stub = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify(status === 200 ? [{ ok: true }] : {}), { status });
  });
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('createJsonClient', () => {
  it('retries a retryable status and returns the body that follows', async () => {
    vi.useFakeTimers();
    const stub = respondInTurn(503, 200);
    const get = createJsonClient({ name: 'Test', baseUrl: 'https://example.test', throttle: passthrough });

    const pending = get('/laps', { session_key: 1 });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual([{ ok: true }]);
    expect(stub).toHaveBeenCalledTimes(2);
    expect(String(stub.mock.calls[0])).toContain('https://example.test/laps?session_key=1');
  });

  it('fails at once on a status that will not change, naming the upstream', async () => {
    const stub = respondInTurn(400);
    const get = createJsonClient({ name: 'Test', baseUrl: 'https://example.test', throttle: passthrough });

    await expect(get('/laps', {})).rejects.toThrow('Test /laps returned 400');
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('reads a 404 as an empty list only when told to', async () => {
    respondInTurn(404, 404);
    const lenient = createJsonClient({ name: 'Test', baseUrl: 'https://example.test', throttle: passthrough, emptyOn404: true });
    const strict = createJsonClient({ name: 'Test', baseUrl: 'https://example.test', throttle: passthrough });

    await expect(lenient('/pit', {})).resolves.toEqual([]);
    await expect(strict('/pit', {})).rejects.toThrow('returned 404');
  });
});
