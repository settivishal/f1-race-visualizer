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
};

export default nextConfig;
