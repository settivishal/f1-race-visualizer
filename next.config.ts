import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Race data changes once a week, when the ingest job runs, so rendering it
  // per request is waste — and on Neon's free tier it is worse than waste,
  // because the compute autosuspends and a sporadic visitor is the one who
  // pays the cold start. Cache Components lets a page be cached and then
  // invalidated by tag at the moment the data actually changes, rather than on
  // a timer that is wrong in both directions.
  //
  // See docs/decisions.md, "Rendering: ISR, revalidated by the ingest job".
  cacheComponents: true,

  // With Cache Components alone, a <Link prefetch> asks for the destination's
  // dynamic content too, and dev flags every race-card prefetch as an expensive
  // one. Partial Prefetching makes a plain <Link> fetch the route's shared App
  // Shell instead, and prefetch={true} adds only the params-dependent part — so
  // the twenty cards on /races warm one shell between them rather than twenty
  // renders. The race pages read `params`, which is exactly the case the docs
  // say to keep prefetch={true} for.
  partialPrefetching: true,

  // The baseline four, on every path. Vercel already serves HSTS, so it is not
  // repeated here — a second `Strict-Transport-Security` would only be a value
  // to keep in sync with theirs.
  //
  // No Content-Security-Policy, deliberately. The theme script in
  // `app/layout.tsx` is inline (it has to be: it runs before first paint, which
  // is the whole point of it), so a real CSP needs a per-request nonce — and a
  // per-request nonce makes the root layout dynamic, which costs every `use
  // cache` page its prerender. That trade is worth its own decision, not a line
  // in this config. See docs/decisions.md.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here is meant to be framed, and the replay canvas in an
          // iframe on someone else's page is the clickjacking shape.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },

  // The Analysis tab used to be `?view=analysis` on the race page and is its own
  // route now, so the page never reads its query string and can be prerendered.
  // Links already out there keep working; the rest of the query string (a
  // head-to-head's `a` and `b`) carries across on its own.
  async redirects() {
    return [
      {
        source: '/races/:slug',
        has: [{ type: 'query', key: 'view', value: 'analysis' }],
        destination: '/races/:slug/analysis',
        permanent: true,
      },
    ];
  },

  // No `serverActions.allowedOrigins`, deliberately. Next compares a Server
  // Action's Origin against the Host and rejects a mismatch on its own; the
  // option exists for proxy and CDN domains, where the two legitimately differ
  // (see node_modules/next/dist/docs/01-app/02-guides/server-actions.md). This
  // site is served directly by Vercel with nothing in front of it, so the
  // default check already holds — and a hardcoded production domain here would
  // be a value to maintain that protects nothing, on a config where every
  // preview deployment has a different hostname.

  // No `images.remotePatterns`, deliberately. The entry that used to be here
  // allowed media.formula1.com for the circuit maps in lib/circuit-data.ts —
  // and that file was deleted in M6.4, so nothing has hotlinked anything since.
  // An allowlist for a host no image is loaded from is a permission granted for
  // no reason.
  //
  // Driver headshot URLs are still ingested and stored, and are still displayed
  // nowhere: they are not licensed for this project to republish, which /about
  // says in as many words. Mirroring them into Vercel Blob would republish them
  // from our own domain, which is further from that position rather than closer
  // to it.
};

export default nextConfig;
