import { Card } from '@/components/ui/card';
import { getRacePredictions } from '@/lib/queries';

/** "42.1%", or "<1%" where one decimal would round a real chance to nothing. */
export function formatProbability(p: number): string {
  return p < 0.01 ? '<1%' : `${(p * 100).toFixed(1)}%`;
}

const generatedLabel = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

type Result = { finalPosition: number | null; status: string; driver: { code: string } | null };

/** "P3", or the status for a car that has no finishing position. */
const finishLabel = (result: Result | undefined) =>
  result ? (result.finalPosition !== null ? `P${result.finalPosition}` : result.status) : '—';

/**
 * The model's win probabilities for a race. Renders nothing
 * when there are none, which is most races: an empty panel would only say
 * "no prediction" about every race the model never ran on.
 *
 * How many drivers it lists, and how many "Show more" opens it to, are the
 * admin's (app_config). A <details> rather than client state, as in the site
 * header, so the disclosure works before any JavaScript.
 *
 * Given the race's results, it is the after-the-race view: each driver's
 * finish beside their chance, and a line on what the model gave the winner.
 */
export async function PredictionPanel({ slug, results }: { slug: string; results?: Result[] }) {
  const { race, predictionDisplay } = await getRacePredictions(slug);
  const predictions = race?.predictions ?? [];
  if (predictions.length === 0) return null;

  const { shown, expanded } = predictionDisplay;
  const top = predictions.slice(0, shown);
  const more = predictions.slice(shown, expanded);
  // Bars are scaled to the favourite so the field reads at a glance; the
  // percentage beside each is the actual number.
  const max = predictions[0].winProbability;
  const resultByCode = new Map(results?.map((result) => [result.driver?.code, result]));
  const winner = results?.find((result) => result.finalPosition === 1)?.driver?.code;
  const winnerRank = predictions.findIndex((prediction) => prediction.driver?.code === winner);

  const rows = (list: typeof predictions, offset: number) => (
    <ol start={offset + 1} className="space-y-2">
      {list.map((prediction, index) => (
        <li key={prediction.driver?.code ?? index} className="flex items-center gap-3 text-sm">
          <span className="tabular w-5 text-right text-muted">{offset + index + 1}</span>
          <span
            aria-hidden
            className="h-6 w-1 shrink-0 rounded-full"
            style={{ backgroundColor: prediction.team?.color ?? 'var(--muted)' }}
          />
          {/* Code only on a phone: the full name leaves the bar no room. */}
          <span className="w-10 shrink-0 truncate sm:w-44">
            <span className="font-semibold">{prediction.driver?.code ?? '—'}</span>
            <span className="hidden text-muted sm:inline"> {prediction.driver?.name}</span>
          </span>
          <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-panel-strong">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(prediction.winProbability / max) * 100}%` }}
            />
          </span>
          <span className="tabular w-14 text-right font-semibold">
            {formatProbability(prediction.winProbability)}
          </span>
          {results ? (
            <span className="tabular w-10 text-right text-muted">
              {finishLabel(resultByCode.get(prediction.driver?.code))}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );

  return (
    <Card>
      <h2 className="type-card-title">{results ? 'Prediction vs result' : 'Win prediction'}</h2>
      <p className="mt-1 text-sm text-muted">
        Model <code className="font-mono text-xs">{predictions[0].modelVersion}</code> · generated{' '}
        {generatedLabel(predictions[0].generatedAt)}
      </p>

      {winner ? (
        <p className="mt-3 text-sm">
          Won by <span className="font-semibold">{winner}</span>
          {winnerRank === -1
            ? ', whom the model did not rate.'
            : `, the model's pick #${winnerRank + 1} at ${formatProbability(predictions[winnerRank].winProbability)}.`}
        </p>
      ) : null}

      <div className="mt-5">{rows(top, 0)}</div>

      {more.length > 0 ? (
        <details className="group mt-2">
          <summary className="tap cursor-pointer list-none py-2 text-sm font-semibold text-accent">
            <span className="group-open:hidden">Show {more.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          {rows(more, shown)}
        </details>
      ) : null}

      <p className="mt-4 text-xs text-muted">
        A model&apos;s estimate from qualifying, not a certainty.
      </p>
    </Card>
  );
}
