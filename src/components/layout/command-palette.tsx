'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CommandPaletteQuery } from '@/graphql/generated/graphql';

/**
 * Press `/` to search races, drivers, teams and circuits.
 *
 * The overlay is the native `<dialog>` element: it brings the top layer, the
 * backdrop, focus trapping, Escape-to-close and `aria-modal` with it, which is
 * most of what a headless dialog dependency sells. What it does not bring is
 * click-outside-to-close, so that is the one handler below.
 *
 * This is the only place in the app that queries `/api/graphql` from the
 * browser. Everything else goes through `executeQuery` in a server component,
 * and should: a palette is interactive per keystroke, which is exactly the case
 * a round trip to the endpoint is for.
 */

type Hit = CommandPaletteQuery['search'][number];

// Kept inline, unlike every server query: the generated documents module holds
// every operation and is not tree-shaken, so importing it here would ship them
// all to the browser. search.graphql is its twin, which codegen validates and
// types; the two must match.
const SEARCH = /* GraphQL */ `
  query CommandPalette($query: String!) {
    search(query: $query) {
      kind
      title
      subtitle
      href
    }
  }
`;

const KIND_LABEL: Record<Hit['kind'], string> = {
  RACE: 'Race',
  DRIVER: 'Driver',
  TEAM: 'Team',
  CIRCUIT: 'Circuit',
};

export function CommandPalette() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState('');
  // The results and the term they answer, in one piece of state. Kept together
  // so "is this list still loading" is a comparison rather than a second flag
  // that has to be turned off on every exit path — including the ones where a
  // request was aborted and no handler ever runs.
  const [result, setResult] = useState<{ term: string; hits: Hit[] }>({ term: '', hits: [] });
  const [active, setActive] = useState(0);

  const term = query.trim();
  const searchable = term.length >= 2;
  const hits = searchable && result.term === term ? result.hits : [];
  const pending = searchable && result.term !== term;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      // A bare key, so it has to yield to anywhere a slash is a character
      // someone meant to type — including this palette's own input, which is
      // where focus sits while it is open.
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      dialogRef.current?.showModal();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounced, and aborted on the next keystroke — without the abort, a slow
  // response for "ham" can land after the fast one for "hamilton" and replace
  // the right list with a stale one.
  useEffect(() => {
    if (!searchable) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: SEARCH, variables: { query: term } }),
          signal: controller.signal,
        });
        const body = (await response.json()) as { data?: CommandPaletteQuery };
        setResult({ term, hits: body.data?.search ?? [] });
        setActive(0);
      } catch {
        // An aborted or failed search leaves the last list on screen rather
        // than flashing an error into a palette the user is still typing in.
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, searchable]);

  function close() {
    dialogRef.current?.close();
  }

  function go(hit: Hit) {
    close();
    router.push(hit.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(hits[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm text-muted transition-colors hover:border-line-strong hover:text-foreground"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className="h-4 w-4">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        {/* Hidden on touch, where there is no key to press.

            `text-muted`, not `text-subtle`: subtle on panel is 3.4:1, which axe
            flags on every page the header renders — and a keyboard hint nobody
            can read is the one label that has to be legible. */}
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
          /
        </kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Search races, drivers, teams and circuits"
        onClose={() => setQuery('')}
        // The backdrop is part of the dialog's own box, so a click lands on the
        // dialog itself; anything inside stops at its own target.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="m-0 mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-line bg-background p-0 text-foreground backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search races, drivers, teams, circuits…"
          aria-label="Search"
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-subtle"
        />

        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {hits.map((hit, index) => (
            <li key={`${hit.kind}-${hit.href}`}>
              <button
                type="button"
                onClick={() => go(hit)}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-baseline gap-3 px-4 py-2.5 text-left text-sm ${
                  index === active ? 'bg-panel-strong' : ''
                }`}
              >
                <span className="w-16 shrink-0 text-eyebrow font-semibold uppercase text-subtle">
                  {KIND_LABEL[hit.kind]}
                </span>
                <span className="truncate font-medium">{hit.title}</span>
                {hit.subtitle ? (
                  <span className="ml-auto shrink-0 truncate text-xs text-muted">{hit.subtitle}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {searchable && hits.length === 0 && !pending ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No matches.</p>
        ) : null}
      </dialog>
    </>
  );
}
