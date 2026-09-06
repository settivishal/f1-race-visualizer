import { executeQuery } from '@/graphql/execute';
import type { HomeLineupQuery } from '@/graphql/generated/graphql';

// Reads through the schema, not around it. A server component could query
// Drizzle directly and be quicker to write, but then GraphQL would be a facade
// over one path rather than the data layer — and the resolvers, the loaders and
// the query budget would go unexercised by the page people actually load.
//
// executeQuery runs in this process, so this costs no more than the direct
// query it replaced.
export const dynamic = 'force-dynamic';

const HOME_LINEUP = /* GraphQL */ `
  query HomeLineup($season: Int!) {
    driverStandings(season: $season) {
      position
      points
      driver { code name number }
      team { name color }
    }
  }
`;

export default async function Home() {
  const { driverStandings } = await executeQuery<HomeLineupQuery, { season: number }>(
    HOME_LINEUP,
    { season: 2025 },
  );

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">F1 Race Visualizer</h1>
      <p className="mt-2 text-sm text-gray-500">
        2025 drivers&rsquo; championship — {driverStandings.length} drivers, derived from race
        results at request time.
      </p>

      <ol className="mt-8 space-y-1">
        {driverStandings.map((standing) => (
          <li key={standing.driver.code} className="flex items-center gap-3 text-sm">
            <span className="w-6 text-right font-mono text-gray-500">{standing.position}</span>
            <span
              className="h-4 w-1 rounded"
              style={{ backgroundColor: standing.team.color ?? '#888888' }}
              aria-hidden
            />
            <span className="w-10 font-mono">{standing.driver.code}</span>
            <span className="flex-1">{standing.driver.name}</span>
            <span className="text-gray-500">{standing.team.name}</span>
            <span className="w-12 text-right font-mono">{standing.points}</span>
          </li>
        ))}
      </ol>

      {driverStandings.length === 0 && (
        <p className="mt-8 text-sm text-red-600">
          No results. Run <code>pnpm tsx scripts/backfill.ts 2025</code>.
        </p>
      )}
    </main>
  );
}
