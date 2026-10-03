/**
 * How many of a route's params a build prerenders.
 *
 * A preview build reads the Neon dev branch, whose monthly transfer allowance
 * it shares with CI and production — and prerendering every race, driver, team
 * and circuit on every push is most of what a preview build reads. So a preview
 * prerenders the first few and renders the rest on first visit. Production
 * prerenders everything unless the caller passes a limit, as the race pages do.
 *
 * Never an empty list: Cache Components fails the build on one. Slicing a
 * non-empty list keeps at least one, and an empty list stays exactly as empty
 * as the caller already made it.
 */
const PREVIEW_PRERENDER_LIMIT = 5;

export function prerenderParams<T>(params: T[], productionLimit = Infinity): T[] {
  const limit = process.env.VERCEL_ENV === 'preview' ? PREVIEW_PRERENDER_LIMIT : productionLimit;
  return params.slice(0, Math.max(1, limit));
}
