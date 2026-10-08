'use client';

import { useSyncExternalStore } from 'react';

// One clock for every countdown on the page, as an external store. A minute is
// the resolution the labels show; a per-second tick would re-render sixty times
// to change nothing. The snapshot has to be a cached value rather than a fresh
// `Date.now()`, because `useSyncExternalStore` compares snapshots and a value
// that changes on every read never settles.
let clock = 0;

function subscribe(onChange: () => void) {
  clock = Date.now();
  onChange();
  const timer = setInterval(() => {
    clock = Date.now();
    onChange();
  }, 60_000);
  return () => clearInterval(timer);
}

/** Now, to the minute, in the browser; 0 on the server and before hydration. */
export function useNow() {
  return useSyncExternalStore(subscribe, () => clock, () => 0);
}
