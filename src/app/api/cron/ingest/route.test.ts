import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cron endpoint's guard.
 *
 * This route can write to the production database, and it is reachable from the
 * public internet by anyone who guesses the path. The 401 is the only thing in
 * front of it — there is no session and no proxy rule, because a scheduled
 * request has no user.
 *
 * The case worth testing most is the missing secret. `CRON_SECRET` unset must
 * deny everything; the tempting shape is to skip the check when there is
 * nothing to check against, which would leave the endpoint wide open in exactly
 * the environment where someone forgot to configure it.
 */
const ORIGINAL = process.env.CRON_SECRET;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

async function callWith(header: string | null, secret: string | undefined) {
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;

  const { POST } = await import('./route');
  const headers = new Headers();
  if (header !== null) headers.set('authorization', header);
  return POST(new Request('http://localhost/api/cron/ingest', { method: 'POST', headers }));
}

describe('cron auth', () => {
  it('denies when CRON_SECRET is not set, rather than skipping the check', async () => {
    const response = await callWith('Bearer anything', undefined);
    expect(response.status).toBe(401);
  });

  it('denies an empty CRON_SECRET', async () => {
    const response = await callWith('Bearer ', '');
    expect(response.status).toBe(401);
  });

  it('denies a missing header', async () => {
    const response = await callWith(null, 'the-real-secret');
    expect(response.status).toBe(401);
  });

  it('denies a wrong secret', async () => {
    const response = await callWith('Bearer not-the-secret', 'the-real-secret');
    expect(response.status).toBe(401);
  });

  it('denies a secret that is a prefix of the real one', async () => {
    const response = await callWith('Bearer the-real', 'the-real-secret');
    expect(response.status).toBe(401);
  });

  it('does not leak the expected value in the response', async () => {
    const response = await callWith('Bearer wrong', 'the-real-secret');
    const body = await response.text();
    expect(body).not.toContain('the-real-secret');
  });
});

describe('OpenF1 live window', () => {
  function upstreamFails(status: number) {
    vi.doMock('@/db', () => ({ getDb: () => ({}) }));
    vi.doMock('@/lib/app-config', () => ({
      readAppConfig: async () => ({
        ingestEnabled: true,
        runDays: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
        activeSeason: 2026,
        hoursAfterRace: 12,
      }),
    }));
    vi.doMock('@/lib/ingest/pending', () => ({
      drainPending: async () => {
        throw Object.assign(new Error(`OpenF1 /sessions returned ${status}`), { status });
      },
    }));
  }

  afterEach(() => {
    vi.doUnmock('@/db');
    vi.doUnmock('@/lib/app-config');
    vi.doUnmock('@/lib/ingest/pending');
  });

  it('skips on a 401, which is OpenF1 mid-session, not a failure', async () => {
    upstreamFails(401);
    const response = await callWith('Bearer the-real-secret', 'the-real-secret');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ skipped: expect.stringContaining('live session') });
  });

  it('still fails on anything else', async () => {
    upstreamFails(500);
    await expect(callWith('Bearer the-real-secret', 'the-real-secret')).rejects.toThrow('returned 500');
  });
});
