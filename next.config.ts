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

  // The circuit maps in lib/circuit-data.ts are hotlinked from formula1.com.
  // next/image refuses a remote host that is not listed here, so without this
  // the circuit panel throws rather than degrading.
  //
  // Hotlinking is the v1 behaviour, kept for now. M4 downloads images at
  // ingest into Vercel Blob (see docs/decisions.md, "Images: downloaded at
  // ingest"), and this entry goes away with it.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'media.formula1.com' }],
  },
};

export default nextConfig;
