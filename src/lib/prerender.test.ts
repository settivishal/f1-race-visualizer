import { afterEach, describe, expect, it, vi } from 'vitest';
import { prerenderParams } from './prerender';

const params = Array.from({ length: 12 }, (_, i) => ({ slug: `race-${i}` }));

describe('prerenderParams', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps every param outside a preview build', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(prerenderParams(params)).toHaveLength(12);
  });

  it('keeps the first five in a preview build, in order', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(prerenderParams(params).map((p) => p.slug)).toEqual(['race-0', 'race-1', 'race-2', 'race-3', 'race-4']);
  });

  it('applies a caller\'s production limit outside a preview build', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(prerenderParams(params, 3)).toHaveLength(3);
  });

  it('never empties a list that had params, which would fail the build', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(prerenderParams(params.slice(0, 1))).toHaveLength(1);
  });
});
