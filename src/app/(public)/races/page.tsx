import { Suspense, ViewTransition } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { RaceStartTime, UpcomingBadge } from '@/components/schedule/upcoming-race';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageContainer } from '@/components/ui/page-container';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getActiveSeason, getRaceLibrary } from '@/lib/queries';
import { seasonRoundLabel } from '@/lib/schedule';

export const metadata = {
  title: 'Races',
  description: 'Every grand prix and sprint in the archive, by season.',
};

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * The race library.
 *
 * v1 did this as a client component that fetched every race on mount and
 * filtered in the browser. Here the filtering is `Query.races(season:,
 * search:)`, and the controls are a plain GET form — so the result set lives
 * in the URL rather than in component state. That makes a filtered view
 * shareable and reloadable, works before any JavaScript arrives, and lets the
 * cache hold the answer, which client-side filtering cannot.
 *
 * The page itself is deliberately not async. `searchParams` is runtime data,
 * and reading it in the page body would stop the whole route prerendering —
 * so the heading ships in the static shell and only the part that genuinely
 * depends on the query string streams in behind a Suspense boundary.
 */
export default function RacesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PageContainer>
      <SectionHeader
        eyebrow="Archive"
        title="Races"
        description="Pick a race to replay it lap by lap."
      />
      <Suspense fallback={<LibrarySkeleton />}>
        <RaceLibrary searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/**
 * Everything below the heading. `searchParams` is read here and the values are
 * passed to `getRaceLibrary` as arguments, because a `use cache` scope cannot
 * touch runtime APIs — and those same arguments are what key the cache entry.
 */
async function RaceLibrary({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const seasonParam = first(params.season);
  const parsedSeason = seasonParam ? Number(seasonParam) : NaN;
  // `?season=all` is explicit, because the default is no longer "everything":
  // landing on the current season is what almost everyone wants, and it fits a
  // single page, which is what makes the pagination controls disappear.
  const season = seasonParam === 'all'
    ? null
    : Number.isInteger(parsedSeason)
      ? parsedSeason
      : await getActiveSeason();

  const search = first(params.q)?.trim() || null;
  const after = first(params.after) ?? null;
  const before = first(params.before) ?? null;

  const { races, seasons, latestRace, nextRace } = await getRaceLibrary(
    season,
    search,
    after,
    before,
  );

  // Grands prix only: a sprint is part of its weekend's card, not a card.
  const scheduled = races.edges
    .filter(({ node }) => node.status === 'SCHEDULED')
    .map(({ node }) => ({ slug: node.slug, date: node.date }));

  // Carried on every link so a filter survives paging and vice versa.
  const context = {
    ...(season === null ? { season: 'all' } : { season: String(season) }),
    ...(search ? { q: search } : {}),
  };

  const fieldClasses =
    'h-10 w-full rounded-md border border-line bg-panel px-3 text-sm text-foreground transition-[border-color] hover:border-line-strong';

  return (
    <>
      {/* Links, not a select with a Filter button. A year is a destination,
          and a destination is an href — it filters on click, needs no
          JavaScript, and each season is a URL someone can send. */}
      <nav aria-label="Season" className="mt-8 flex flex-wrap gap-1.5">
        {[...seasons].reverse().map((entry) => {
          const isActive = season === entry.year;
          return (
            <Link
              key={entry.year}
              href={{ pathname: '/races', query: { season: String(entry.year), ...(search ? { q: search } : {}) } }}
              aria-current={isActive ? 'page' : undefined}
              className={`tap tabular inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-accent-fill text-on-accent'
                  : 'border border-line text-muted hover:border-line-strong hover:text-foreground'
              }`}
            >
              {entry.year}
            </Link>
          );
        })}
        <Link
          href={{ pathname: '/races', query: { season: 'all', ...(search ? { q: search } : {}) } }}
          aria-current={season === null ? 'page' : undefined}
          className={`tap inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
            season === null
              ? 'bg-accent-fill text-on-accent'
              : 'border border-line text-muted hover:border-line-strong hover:text-foreground'
          }`}
        >
          All seasons
        </Link>
      </nav>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3">
        {/* The season rides along as a hidden field, so searching does not
            silently throw away the year the reader chose. */}
        <input type="hidden" name="season" value={season === null ? 'all' : String(season)} />

        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-eyebrow font-semibold uppercase text-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Monaco, Silverstone, sprint…"
            className={fieldClasses}
          />
        </label>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {races.edges.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No races match"
            description="Try a different season, or clear the search."
            action={
              <Link href="/races">
                <Button variant="secondary" size="sm">
                  Clear filters
                </Button>
              </Link>
            }
          />
        </div>
      ) : (
        // `auto-rows-fr` so a row of cards is one height whatever each holds —
        // a sprint line, an Upcoming badge, a podium or none of them. Without
        // it the grid stretches the <li> and nothing inside it, and the cards
        // came out ragged.
        <ul className="mt-8 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {races.edges.map(({ node }) => (
            <li key={node.id} className="h-full">
              {/* Not one big <Link> any more: a sprint weekend's card carries a
                  second link, and a link inside a link is not markup a browser
                  or a screen reader can make sense of. The title is the real
                  link and stretches over the card with `after:inset-0`, so the
                  whole tile stays clickable and the sprint row sits above it. */}
              {/* The glow sits on the wrapper, not the card: Card already
                  carries `shadow-sm`, and cn() is a join rather than a
                  tailwind-merge, so a second shadow utility there loses to
                  whichever the stylesheet happens to order last. */}
              <div
                className={`group h-full rounded-xl ${
                  // The one race just run. A glow rather than a badge: it says
                  // "here" without taking a word away from the tile.
                  node.slug === latestRace?.slug ? 'shadow-glow' : ''
                }`}
              >
                <Card
                  className={`relative flex h-full gap-4 transition-[background-color,border-color] group-hover:border-line-strong group-hover:bg-panel-strong ${
                    node.slug === latestRace?.slug ? 'border-accent/40' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-eyebrow font-semibold uppercase text-muted">
                        {node.meeting
                          ? seasonRoundLabel(node.meeting.season, node.meeting.round)
                          : 'Season unknown'}
                      </span>
                      {/* Only the next one. Every scheduled race carrying this
                          badge made it mean "not yet run", which the date below
                          already says. */}
                      {node.status === 'SCHEDULED' ? (
                        <UpcomingBadge
                          slug={node.slug}
                          serverNext={nextRace?.slug ?? null}
                          scheduled={scheduled}
                        />
                      ) : null}
                      {node.status === 'CANCELLED' ? <Badge>Cancelled</Badge> : null}
                    </div>
                    {/* The same name on the race page's <h1>, so the title is
                        one object that moves rather than two that swap. */}
                    <ViewTransition name={`race-title-${node.slug}`} share="race-morph" default="none">
                      <h2 className="type-card-title mt-2.5">
                        {/* prefetch: the race pages are prerendered and cached,
                            so warming one on hover costs almost nothing and
                            removes the wait on the click that matters. */}
                        <Link
                          href={`/races/${node.slug}`}
                          prefetch
                          className="rounded-sm after:absolute after:inset-0 after:rounded-xl after:content-['']"
                        >
                          {node.meeting?.name ?? node.slug}
                        </Link>
                      </h2>
                    </ViewTransition>
                    <p className="mt-1.5 text-sm text-muted">
                      {node.meeting?.circuitName ?? node.meeting?.country ?? '—'} ·{' '}
                      {node.status === 'CANCELLED' ? (
                        <span className="line-through">Not held</span>
                      ) : node.status === 'SCHEDULED' ? (
                        <RaceStartTime date={node.date} />
                      ) : (
                        <>
                          <span className="tabular">{node.laps}</span> laps
                        </>
                      )}
                    </p>

                    {/* The other half of the weekend, on the line below rather
                        than in a section of its own: a footer row only some
                        cards have leaves the rest of the grid holding empty
                        space, since a row of cards is as tall as its tallest. */}
                    {node.weekendSprint ? (
                      <Link
                        href={`/races/${node.weekendSprint.slug}`}
                        // Its own thing, not a third line of the same
                        // paragraph: an accent rule down the left separates the
                        // weekend's other session from this one's details, and
                        // it lights up on hover so a click that leaves for a
                        // different race says so before it happens.
                        className="tap group/sprint relative mt-2 inline-flex w-fit items-center gap-1.5 rounded-md border-l-2 border-line bg-panel-strong/50 py-1 pl-2 pr-2 text-sm text-muted transition-[background-color,border-color,color] hover:border-accent hover:bg-accent-soft hover:text-foreground"
                      >
                        <span className="text-eyebrow font-semibold uppercase text-subtle transition-colors group-hover/sprint:text-accent">
                          Sprint
                        </span>
                        {node.weekendSprint.podium[0] ? (
                          <>
                            <span
                              aria-hidden
                              className="h-3.5 w-[3px] rounded-full"
                              style={{
                                backgroundColor:
                                  node.weekendSprint.podium[0].teamColor ?? 'var(--muted)',
                              }}
                            />
                            <span className="font-mono font-semibold text-foreground">
                              {node.weekendSprint.podium[0].code}
                            </span>
                          </>
                        ) : (
                          <span>
                            {node.weekendSprint.status === 'CANCELLED' ? 'Not held' : 'Not yet run'}
                          </span>
                        )}
                        {/* Only on hover, and only as a word: the row already
                            says which session it is, and this says what
                            clicking it does. */}
                        <span className="hidden text-xs text-accent group-hover/sprint:inline">
                          replay
                        </span>
                        <span
                          aria-hidden
                          className="text-accent transition-transform group-hover/sprint:translate-x-0.5"
                        >
                          →
                        </span>
                      </Link>
                    ) : null}
                  </div>

                  {/* The result, which is what the tile was missing. Empty for a
                      race not yet run, so no status test is needed here. */}
                  {node.podium.length > 0 ? (
                    <ol className="flex shrink-0 flex-col justify-center gap-1.5">
                      {node.podium.map((slot) => (
                        <li key={slot.position} className="flex items-center gap-2">
                          <span className="tabular w-3 text-eyebrow font-semibold text-subtle">
                            {slot.position}
                          </span>
                          <span
                            aria-hidden
                            className="h-4 w-[3px] rounded-full"
                            style={{ backgroundColor: slot.teamColor ?? 'var(--muted)' }}
                          />
                          <span className="font-mono text-sm font-semibold">{slot.code}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </Card>
              </div>
            </li>
          ))}
        </ul>
      )}

      {races.pageInfo.hasPreviousPage || races.pageInfo.hasNextPage ? (
        <div className="mt-8 flex justify-center gap-3">
          {races.pageInfo.hasPreviousPage && races.pageInfo.startCursor ? (
            <Link
              href={{ pathname: '/races', query: { ...context, before: races.pageInfo.startCursor } }}
              className="rounded-md"
            >
              <Button variant="secondary">← Previous</Button>
            </Link>
          ) : null}
          {races.pageInfo.hasNextPage && races.pageInfo.endCursor ? (
            <Link
              href={{ pathname: '/races', query: { ...context, after: races.pageInfo.endCursor } }}
              className="rounded-md"
            >
              <Button variant="secondary">Next →</Button>
            </Link>
          ) : null}
        </div>
      ) : null}

    </>
  );
}

/** Sized to a filled grid, so the page does not grow as the races arrive. */
function LibrarySkeleton() {
  return (
    <div className="mt-8">
      <Skeleton className="h-10 w-full max-w-2xl" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[8.5rem] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
