import { db } from '@/db';

// M0's vertical slice: database to page, no cache, no GraphQL yet.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const lineup = await db.query.driverTeamAssignments.findMany({
    with: { driver: true, teamSeason: { with: { team: true } } },
  });

  const grid = lineup
    .map((a) => ({
      code: a.driver.code,
      name: a.driver.name,
      number: a.driver.number,
      team: a.teamSeason.team.name,
      color: a.teamSeason.color ?? a.teamSeason.team.color ?? '#888888',
    }))
    .sort((a, b) => a.team.localeCompare(b.team) || a.code.localeCompare(b.code));

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">F1 Race Visualizer</h1>
      <p className="mt-2 text-sm text-gray-500">
        M0 — {grid.length} seeded drivers, read from Neon at request time.
      </p>

      <ul className="mt-8 space-y-1">
        {grid.map((d) => (
          <li key={d.code} className="flex items-center gap-3 text-sm">
            <span className="h-4 w-1 rounded" style={{ backgroundColor: d.color }} aria-hidden />
            <span className="w-10 font-mono">{d.code}</span>
            <span className="w-8 text-right font-mono text-gray-500">{d.number}</span>
            <span className="flex-1">{d.name}</span>
            <span className="text-gray-500">{d.team}</span>
          </li>
        ))}
      </ul>

      {grid.length === 0 && (
        <p className="mt-8 text-sm text-red-600">
          No drivers. Run <code>pnpm db:seed</code>.
        </p>
      )}
    </main>
  );
}
