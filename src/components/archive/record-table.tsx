import { Card } from "@/components/ui/card";

export type RecordRow = {
  season: number;
  teamName?: string | null;
  teamColor?: string | null;
  starts: number;
  wins: number;
  podiums: number;
  points: number;
  bestFinish: number | null;
};

/**
 * A season-by-season record, for a driver or for a team.
 *
 * One component for both because the columns are the same question asked of a
 * different subject; the team column simply drops out when the subject *is* the
 * team. Splitting it would duplicate a table to vary one cell.
 */
export function RecordTable({
  rows,
  caption,
  showTeam = true,
}: {
  rows: RecordRow[];
  caption: string;
  showTeam?: boolean;
}) {
  return (
    <Card flush className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-eyebrow uppercase text-muted">
            <th scope="col" className="py-3 pl-5 pr-3 font-semibold">Season</th>
            {showTeam ? (
              <th scope="col" className="py-3 pr-3 font-semibold">Team</th>
            ) : null}
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Starts</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Wins</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Podiums</th>
            <th scope="col" className="py-3 pr-3 text-right font-semibold">Best</th>
            <th scope="col" className="py-3 pr-5 text-right font-semibold">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${row.season}-${row.teamName ?? index}`}
              className="border-b border-line/60 last:border-0"
            >
              <td className="tabular py-2.5 pl-5 pr-3 font-semibold">{row.season}</td>
              {showTeam ? (
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="h-4 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: row.teamColor ?? "var(--muted)" }}
                      aria-hidden
                    />
                    <span className="text-muted">{row.teamName ?? "—"}</span>
                  </span>
                </td>
              ) : null}
              <td className="tabular py-2.5 pr-3 text-right">{row.starts}</td>
              <td className="tabular py-2.5 pr-3 text-right">{row.wins}</td>
              <td className="tabular py-2.5 pr-3 text-right">{row.podiums}</td>
              <td className="tabular py-2.5 pr-3 text-right text-muted">
                {row.bestFinish === null ? "—" : `P${row.bestFinish}`}
              </td>
              <td className="tabular py-2.5 pr-5 text-right font-semibold">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** The headline numbers above a record table. */
export function StatRow({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-xl border border-line bg-panel px-4 py-3">
          <dt className="text-eyebrow font-semibold uppercase text-muted">{stat.label}</dt>
          <dd className="tabular mt-1 text-2xl font-bold tracking-tight">{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
