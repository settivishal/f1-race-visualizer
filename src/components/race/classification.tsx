import { Card } from '@/components/ui/card';
import type { RaceHeaderQuery } from '@/graphql/generated/graphql';
import { gridDelta, lapsDown } from './classification-math';

type Result = NonNullable<RaceHeaderQuery['race']>['results'][number];

/**
 * The final classification, told as the race rather than listed: the podium on
 * its steps, then every other car as a bar of how far it got, with what it
 * gained or lost from the grid.
 *
 * Only what both upstreams record. There is no gap or race time — `gap` is
 * null on every row — so a bar of distance stands in for a column of times.
 */
export function Classification({ results, caption }: { results: Result[]; caption: string }) {
  const sorted = [...results].sort((a, b) => {
    // No finishing position sorts after everyone who has one, not to the
    // front on a null.
    if (a.finalPosition === null) return b.finalPosition === null ? 0 : 1;
    if (b.finalPosition === null) return -1;
    return a.finalPosition - b.finalPosition;
  });
  // The winner's distance, not the scheduled one: a race shortened by a red
  // flag would otherwise show every finisher as laps down.
  const raceLaps = Math.max(0, ...results.map((result) => result.lapsCompleted));
  const podium = sorted.filter((result) => result.finalPosition !== null && result.finalPosition <= 3);
  const hasPodium = podium.length === 3;
  const rest = hasPodium ? sorted.slice(3) : sorted;
  // Sprints carry no grid, and a column of dashes says nothing.
  const showGrid = results.some((result) => result.gridPosition != null);

  return (
    <section className="mt-10">
      <h2 className="type-section-title">Classification</h2>

      {hasPodium ? (
        <ol aria-label="Podium" className="mt-4 grid items-end gap-3 sm:grid-cols-3">
          {podium.map((result) => (
            <PodiumStep key={result.driver?.code ?? result.finalPosition} result={result} showGrid={showGrid} />
          ))}
        </ol>
      ) : null}

      <Card className="mt-4 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-eyebrow uppercase text-muted">
              <th scope="col" className="w-12 py-3 pl-4 pr-2 font-semibold sm:w-14 sm:pl-5 sm:pr-3">Pos</th>
              <th scope="col" className="py-3 pr-3 font-semibold">Driver</th>
              <th scope="col" className="w-[24%] py-3 pr-3 font-semibold sm:w-[38%]">Race</th>
              {showGrid ? (
                <th scope="col" className="hidden py-3 pr-3 text-right font-semibold sm:table-cell">Grid</th>
              ) : null}
              <th scope="col" className="py-3 pr-5 text-right font-semibold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rest.map((result, index) => (
              <tr
                key={result.driver?.code ?? `row-${index}`}
                className="border-b border-line/60 last:border-0"
              >
                <td className="tabular py-3 pl-4 pr-2 font-semibold text-muted sm:pl-5 sm:pr-3">
                  <PositionLabel result={result} />
                </td>
                <td className="py-3 pr-3">
                  <DriverCell result={result} gridOnPhone={showGrid} />
                </td>
                <td className="py-3 pr-3">
                  <DistanceBar result={result} raceLaps={raceLaps} />
                </td>
                {showGrid ? (
                  <td className="hidden py-3 pr-3 text-right sm:table-cell">
                    <GridChange result={result} />
                  </td>
                ) : null}
                <td
                  className={`tabular py-3 pr-5 text-right ${
                    result.points > 0 ? 'font-bold' : 'text-subtle'
                  }`}
                >
                  {result.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

/** P2, P1, P3 left to right on a desktop, the way a podium stands. */
const STEP: Record<number, string> = {
  1: 'sm:order-2 sm:pt-10 podium-lead border-accent/40 bg-accent-soft',
  2: 'sm:order-1 sm:pt-6 border-line bg-panel',
  3: 'sm:order-3 sm:pt-3 border-line bg-panel',
};

function PodiumStep({ result, showGrid }: { result: Result; showGrid: boolean }) {
  const position = result.finalPosition ?? 0;
  // On the podium only a move is worth a mark; "=" beside the points read as
  // part of them.
  const moved = showGrid && (gridDelta(result) ?? 0) !== 0;
  return (
    <li
      className={`relative overflow-hidden rounded-xl border px-5 pb-5 pt-4 ${STEP[position] ?? ''}`}
    >
      {/* The team's colour across the top of the step, like a livery stripe. */}
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: result.team?.color ?? 'var(--muted)' }}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <span
          className={`font-heading text-5xl font-extrabold leading-none tabular ${
            position === 1 ? 'text-accent' : 'text-subtle'
          }`}
        >
          {position}
        </span>
        <span className="flex items-center gap-2">
          {moved ? <GridChange result={result} /> : null}
          <span className="tabular rounded-md bg-panel-strong px-2 py-0.5 text-xs font-bold">
            {result.points} pts
          </span>
        </span>
      </div>
      <div className="mt-4">
        <DriverCell result={result} large />
      </div>
    </li>
  );
}

function DriverCell({
  result,
  large = false,
  gridOnPhone = false,
}: {
  result: Result;
  large?: boolean;
  /** A phone has no Grid column; the change rides on the team line instead. */
  gridOnPhone?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      {large ? null : (
        <span
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: result.team?.color ?? 'var(--muted)' }}
          aria-hidden
        />
      )}
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="hidden font-mono text-xs font-medium text-muted sm:inline">
            {result.driver?.code ?? '—'}
          </span>
          <span className={`truncate font-semibold ${large ? 'text-lg' : ''}`}>
            {result.driver?.name ?? 'Unknown driver'}
          </span>
          {result.fastestLap ? <FastestLap /> : null}
        </span>
        <span className="flex items-center gap-2 truncate text-xs text-muted">
          {result.team?.name ?? '—'}
          {gridOnPhone && gridDelta(result) !== null ? (
            <span className="sm:hidden">
              <GridChange result={result} />
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}

/** The broadcast's mark: a purple stopwatch, the timing tower's fastest-of-all colour. */
function FastestLap() {
  return (
    <span
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-timing-best text-white dark:text-track"
      title="Fastest lap"
    >
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
        <circle cx="8" cy="9" r="5" />
        <path d="M8 9V6.5M6.5 2h3M12 4.5l1-1" />
      </svg>
      <span className="sr-only">Fastest lap</span>
    </span>
  );
}

function PositionLabel({ result }: { result: Result }) {
  if (result.finalPosition !== null) return <>{result.finalPosition}</>;
  // Finished, but under 90% of the distance: the sport's "not classified".
  if (result.status === 'FINISHED') return <abbr title="Not classified" className="no-underline">NC</abbr>;
  return <>{result.status}</>;
}

/** How far the car got, as a share of the winner's distance. */
function DistanceBar({ result, raceLaps }: { result: Result; raceLaps: number }) {
  const share = raceLaps > 0 ? Math.min(1, result.lapsCompleted / raceLaps) : 0;
  const down = lapsDown(result, raceLaps);
  const stopped = result.status === 'DNF';
  const label =
    result.status === 'DNS'
      ? 'Did not start'
      : result.status === 'DSQ'
        ? 'Disqualified'
        : stopped
        ? `Out lap ${result.lapsCompleted}`
        : result.finalPosition === null
          ? `NC · ${result.lapsCompleted} laps`
          : down > 0
            ? `+${down} lap${down === 1 ? '' : 's'}`
            : null;

  return (
    <span className="flex items-center gap-3">
      <span className="relative h-1.5 min-w-12 flex-1 rounded-full bg-line" aria-hidden>
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${share * 100}%`,
            backgroundColor: result.team?.color ?? 'var(--muted)',
            opacity: result.finalPosition === null ? 0.55 : 1,
          }}
        />
        {stopped && share > 0 ? (
          // Where the car stopped, as the replay marks a retirement.
          <span
            className="absolute top-1/2 grid size-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-track text-[8px] font-bold leading-none text-white"
            style={{ left: `${share * 100}%`, borderColor: result.team?.color ?? 'var(--muted)' }}
          >
            ×
          </span>
        ) : null}
      </span>
      <span className="sr-only">
        {result.lapsCompleted} of {raceLaps} laps
      </span>
      {/* Off on a phone: the Pos column already says DNF or NC, and the bar
          needs the width more than the words do. */}
      <span className="tabular hidden w-24 shrink-0 text-xs text-muted sm:block" aria-hidden={label === null}>
        {label}
      </span>
    </span>
  );
}

function GridChange({ result }: { result: Result }) {
  const delta = gridDelta(result);
  if (delta === null) return <span className="text-subtle">—</span>;
  const title = `Started P${result.gridPosition}`;
  if (delta === 0) {
    return (
      <span className="tabular text-xs font-semibold text-muted" title={title}>
        =<span className="sr-only">, held position from P{result.gridPosition}</span>
      </span>
    );
  }
  const gained = delta > 0;
  return (
    <span
      className={`tabular inline-flex items-center gap-0.5 text-xs font-bold ${
        gained ? 'text-flag-green' : 'text-flag-red'
      }`}
      title={title}
    >
      <span aria-hidden>{gained ? '▲' : '▼'}</span>
      {Math.abs(delta)}
      <span className="sr-only">
        {gained ? ' places gained' : ' places lost'} from P{result.gridPosition}
      </span>
    </span>
  );
}
