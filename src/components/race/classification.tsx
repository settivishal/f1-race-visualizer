import { CELL, Entrant, FIRST, LAST, ResultsTable, Row, TopThree } from '@/components/ui/results-table';
import type { RaceHeaderQuery } from '@/graphql/generated/graphql';
import { gridDelta, lapsDown } from './classification-math';

type Result = NonNullable<RaceHeaderQuery['race']>['results'][number];

/**
 * The final classification: the podium as one quiet strip, then everyone else
 * as a list that says in words how their race ended.
 *
 * Colour is kept for meaning. The team is a bar beside the code, the grid
 * change is green or red, and nothing else is coloured — so the eye lands on
 * the few things that differ rather than on twenty liveries. Only cars that
 * did not finish get a distance line, so a retirement stands out from a list
 * of finishers instead of hiding among twenty full bars.
 *
 * Only what both upstreams record. There is no gap or race time — `gap` is
 * null on every row — so the words carry what a time column would.
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

      <ResultsTable
        caption={caption}
        top={
          hasPodium ? (
            <TopThree
              label="Podium"
              leadLabel={
                <>
                  <ChequeredFlag />
                  Winner
                </>
              }
              places={podium.map((result) => {
                const delta = showGrid ? gridDelta(result) : null;
                return {
                  position: result.finalPosition ?? 0,
                  code: result.driver?.code,
                  title: result.driver?.name ?? 'Unknown driver',
                  subtitle: result.team?.name ?? '—',
                  color: result.team?.color ?? null,
                  mark: result.fastestLap ? <FastestLap /> : null,
                  points: result.points,
                  note:
                    delta !== null && delta !== 0 ? (
                      <>
                        <GridChange result={result} /> from P{result.gridPosition}
                      </>
                    ) : null,
                };
              })}
            />
          ) : null
        }
        columns={[
          { label: 'Pos' },
          { label: 'Driver', className: 'md:w-64' },
          { label: 'Team', className: 'hidden md:table-cell' },
          { label: 'Result', className: 'w-24 sm:w-[30%]' },
          ...(showGrid ? [{ label: 'Grid', className: 'hidden w-16 text-right sm:table-cell' }] : []),
          { label: 'Pts' },
        ]}
      >
        {rest.map((result, index) => (
          <Row key={result.driver?.code ?? `row-${index}`}>
            <td className={FIRST}>
              <PositionLabel result={result} />
            </td>
            <td className={CELL}>
              <Entrant
                code={result.driver?.code}
                name={result.driver?.name ?? 'Unknown driver'}
                color={result.team?.color ?? null}
                mark={result.fastestLap ? <FastestLap /> : null}
              />
            </td>
            <td className={`${CELL} hidden truncate text-muted md:table-cell`}>{result.team?.name ?? '—'}</td>
            <td className={CELL}>
              <RaceEnd result={result} raceLaps={raceLaps} />
            </td>
            {showGrid ? (
              <td className={`${CELL} hidden text-right sm:table-cell`}>
                <GridChange result={result} />
              </td>
            ) : null}
            <td className={`${LAST} ${result.points > 0 ? 'font-semibold' : 'text-subtle'}`}>
              {result.points}
            </td>
          </Row>
        ))}
      </ResultsTable>
    </section>
  );
}

function ChequeredFlag() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
      <rect width="12" height="12" rx="1.5" className="fill-current opacity-25" />
      <path
        d="M0 0h3v3H0zM6 0h3v3H6zM3 3h3v3H3zM9 3h3v3H9zM0 6h3v3H0zM6 6h3v3H6zM3 9h3v3H3zM9 9h3v3H9z"
        className="fill-current"
      />
    </svg>
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

/**
 * How the race ended, in words. A car that stopped short of the flag also gets
 * a hairline of how far it got, so the few who did are the only marks in the
 * column.
 */
function RaceEnd({ result, raceLaps }: { result: Result; raceLaps: number }) {
  const down = lapsDown(result, raceLaps);
  const classified = result.finalPosition !== null;
  const text =
    result.status === 'DNS'
      ? 'Did not start'
      : result.status === 'DSQ'
        ? 'Disqualified'
        : result.status === 'DNF'
          ? `Retired · lap ${result.lapsCompleted}`
          : !classified
            ? `Not classified · ${result.lapsCompleted} laps`
            : down > 0
              ? `+${down} lap${down === 1 ? '' : 's'}`
              : 'Finished';
  // The Pos column already says DNF, NC, DNS or DSQ, so a phone's narrow
  // column keeps only the number that goes with it.
  const brief =
    result.status === 'DNF'
      ? `Out lap ${result.lapsCompleted}`
      : !classified && result.status === 'FINISHED'
        ? `${result.lapsCompleted} laps`
        : down > 0
          ? text
          : '—';
  const stoppedShort = !classified && result.status !== 'DNS' && result.status !== 'DSQ';
  const share = raceLaps > 0 ? Math.min(1, result.lapsCompleted / raceLaps) : 0;

  return (
    <span className="block">
      <span className={classified && down === 0 ? 'text-muted' : ''}>
        <span className="sr-only sm:not-sr-only">{text}</span>
        <span className="sm:hidden" aria-hidden>
          {brief}
        </span>
      </span>
      {stoppedShort ? (
        <span className="mt-1.5 block h-px w-full max-w-40 bg-line" aria-hidden>
          <span className="block h-px bg-muted" style={{ width: `${share * 100}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** Places from the grid: green gained, red lost, a dash for held. */
function GridChange({ result }: { result: Result }) {
  const delta = gridDelta(result);
  if (delta === null) return null;
  const title = `Started P${result.gridPosition}`;
  if (delta === 0) {
    return (
      <span className="tabular text-subtle" title={title}>
        —<span className="sr-only">held position from P{result.gridPosition}</span>
      </span>
    );
  }
  const gained = delta > 0;
  return (
    <span
      className={`tabular font-semibold ${gained ? 'text-flag-green' : 'text-flag-red'}`}
      title={title}
    >
      {gained ? '+' : '−'}
      {Math.abs(delta)}
      <span className="sr-only">
        {gained ? ' places gained' : ' places lost'} from P{result.gridPosition}
      </span>
    </span>
  );
}
