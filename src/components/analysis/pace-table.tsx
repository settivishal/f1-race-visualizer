import { Card } from "@/components/ui/card";
import { formatLapTime } from "@/lib/scale";

export type PaceRow = {
  code: string;
  name: string;
  teamName: string;
  color: string;
  best: number | null;
  median: number | null;
  consistency: number | null;
  lapsCounted: number;
  lapsExcluded: number;
};

/**
 * The pace table: the fastest lap everybody quotes, next to the median that
 * actually decided the race, next to how repeatably each driver hit it.
 *
 * Gaps are shown against the quickest median rather than as absolute times,
 * because the number a reader wants is "how much slower", and subtracting two
 * 1:32s in their head is work the table can do for them.
 */
export function PaceTable({ rows }: { rows: PaceRow[] }) {
  const ranked = [...rows].sort((a, b) => {
    if (a.median === null) return b.median === null ? 0 : 1;
    if (b.median === null) return -1;
    return a.median - b.median;
  });

  const reference = ranked.find((r) => r.median !== null)?.median ?? null;

  return (
    <Card flush className="overflow-x-auto">
      <table className="w-full min-w-[38rem] text-left text-sm">
        <caption className="sr-only">
          Race pace by driver: best lap, median lap, gap to the quickest median,
          and lap-time consistency
        </caption>
        <thead>
          <tr className="border-b border-line text-eyebrow uppercase text-muted">
            <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Driver</th>
            <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Best</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Median</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Gap</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold" title="Standard deviation of the representative laps">
              ± s
            </th>
            <th scope="col" className="py-3 pr-5 text-right font-semibold" title="Laps counted, after pit, out and safety-car laps are set aside">
              Laps
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row) => (
            <tr key={row.code} className="border-b border-line/60 last:border-0">
              <td className="py-2.5 pl-5 pr-3">
                <span className="flex items-center gap-2.5">
                  <span
                    className="h-4 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: row.color }}
                    aria-hidden
                  />
                  <span className="font-mono text-xs font-medium text-muted">{row.code}</span>
                  <span className="font-medium">{row.name}</span>
                </span>
              </td>
              <td className="py-2.5 pr-3 text-muted">{row.teamName}</td>
              <td className="tabular py-2.5 pr-3 text-right">
                {row.best === null ? "—" : formatLapTime(row.best)}
              </td>
              <td className="tabular py-2.5 pr-3 text-right font-semibold">
                {row.median === null ? "—" : formatLapTime(row.median)}
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-muted">
                {row.median === null || reference === null || row.median === reference
                  ? "—"
                  : `+${(row.median - reference).toFixed(3)}`}
              </td>
              <td className="tabular py-2.5 pr-3 text-right text-muted">
                {row.consistency === null ? "—" : row.consistency.toFixed(3)}
              </td>
              <td className="tabular py-2.5 pr-5 text-right text-muted">
                {row.lapsCounted}
                {row.lapsExcluded > 0 ? (
                  <span className="text-subtle"> /{row.lapsCounted + row.lapsExcluded}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
