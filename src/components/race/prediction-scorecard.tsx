import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { getPredictionScorecard } from '@/lib/queries';
import { formatProbability } from './prediction-panel';

/** Rows before "Show more"; the newest races are the ones anyone asks about. */
const SHOWN = 5;

/**
 * How the win model has done on races it called before the start: did its
 * favourite win, and what chance did it give whoever did. Renders nothing
 * until one such race has run.
 */
export async function PredictionScorecard() {
  const { scoredRaces } = await getPredictionScorecard();

  const rows = scoredRaces.flatMap((race) => {
    const pick = race.predictions[0];
    const winner = race.podium.find((slot) => slot.position === 1);
    // A run race with no winner recorded yet has nothing to score.
    if (!pick || !winner) return [];
    const given = race.predictions.find((p) => p.driver?.code === winner.code)?.winProbability ?? 0;
    return [{ slug: race.slug, name: race.meeting?.name ?? race.slug, pick, winner, given, hit: pick.driver?.code === winner.code }];
  });
  if (rows.length === 0) return null;

  const hits = rows.filter((row) => row.hit).length;
  const average = rows.reduce((sum, row) => sum + row.given, 0) / rows.length;

  const table = (list: typeof rows) => (
    <table className="w-full text-left text-sm">
      <thead className="sr-only">
        <tr>
          <th scope="col">Race</th>
          <th scope="col">Model&apos;s pick</th>
          <th scope="col">Winner</th>
          <th scope="col">Pick won</th>
        </tr>
      </thead>
      <tbody>
        {list.map((row) => (
          <tr key={row.slug} className="border-b border-line/60 last:border-0">
            <th scope="row" className="max-w-40 truncate py-2 pr-3 font-normal">
              <Link href={`/races/${row.slug}`} className="hover:text-accent">
                {row.name}
              </Link>
            </th>
            <td className="tabular py-2 pr-3 whitespace-nowrap text-muted">
              <span className="font-semibold text-foreground">{row.pick.driver?.code ?? '—'}</span>{' '}
              {formatProbability(row.pick.winProbability)}
            </td>
            <td className="tabular py-2 pr-3 whitespace-nowrap text-muted">
              <span
                aria-hidden
                className="mr-1.5 inline-block h-3 w-1 rounded-full align-middle"
                style={{ backgroundColor: row.winner.teamColor ?? 'var(--muted)' }}
              />
              <span className="font-semibold text-foreground">{row.winner.code}</span>{' '}
              {row.hit ? null : formatProbability(row.given)}
            </td>
            <td className="py-2 text-right">
              <span aria-hidden className={row.hit ? 'text-accent' : 'text-subtle'}>
                {row.hit ? '✓' : '✗'}
              </span>
              <span className="sr-only">{row.hit ? 'yes' : 'no'}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card className="mt-8">
      <h2 className="type-card-title">Prediction scorecard</h2>
      <p className="mt-1 text-sm text-muted">
        The model&apos;s favourite won <span className="font-semibold text-foreground">{hits} of {rows.length}</span>{' '}
        {rows.length === 1 ? 'race' : 'races'} it called before the start. It gave the winner{' '}
        {formatProbability(average)} on average.
      </p>

      <div className="mt-4">{table(rows.slice(0, SHOWN))}</div>

      {rows.length > SHOWN ? (
        <details className="group">
          <summary className="tap cursor-pointer list-none py-2 text-sm font-semibold text-accent">
            <span className="group-open:hidden">Show {rows.length - SHOWN} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          {table(rows.slice(SHOWN))}
        </details>
      ) : null}

      <p className="mt-3 text-xs text-muted">
        Model <code className="font-mono">{rows[0].pick.modelVersion}</code>, from qualifying alone.
      </p>
    </Card>
  );
}
