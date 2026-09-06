import Link from 'next/link';
import { getDriverStandings } from '@/lib/queries';

// Reads through the schema, not around it. A server component could query
// Drizzle directly and be quicker to write, but then GraphQL would be a facade
// over one path rather than the data layer — and the resolvers, the loaders and
// the query budget would go unexercised by the page people actually load.
//
// The query itself now lives in lib/queries.ts, inside a `use cache` scope
// tagged `standings`. This page was `force-dynamic`, which re-derived the
// championship from race_results on every single request; the standings change
// once a week.
export default async function Home() {
  const { driverStandings } = await getDriverStandings(2025);

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">F1 Race Visualizer</h1>
      <p className="mt-2 text-sm text-gray-500">
        2025 drivers&rsquo; championship — {driverStandings.length} drivers, derived from race
        results rather than stored.
      </p>

      <p className="mt-4 text-sm">
        <Link href="/races" className="text-accent underline underline-offset-4">
          Browse every race →
        </Link>
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
