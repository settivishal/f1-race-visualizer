import 'dotenv/config';
import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { execute, parse } from 'graphql';
import * as dbSchema from '@/db/schema';
import { schema } from '@/graphql/schema';

/**
 * Counts the SQL statements one GraphQL query costs.
 *
 * Verification step 3 says the count must be bounded and "not assumed". The
 * Neon console query log is the authority; this is the version that can be run
 * repeatedly while the loaders are being wired.
 *
 * It executes against the real schema and the real resolvers, with a context
 * whose pool counts every statement — so the number is the resolvers' actual
 * behaviour, not a model of it.
 *
 *   pnpm tsx scripts/count-queries.ts [race-slug]
 */
const slug = process.argv[2] ?? '2025-monte-carlo';

let count = 0;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const realQuery = pool.query.bind(pool);
Object.assign(pool, {
  query: (...args: Parameters<typeof realQuery>) => {
    count++;
    return realQuery(...args);
  },
});

const db = drizzle(pool, { schema: dbSchema });

const REPLAY_QUERY = /* GraphQL */ `
  query CountReplay($slug: String!) {
    race(slug: $slug) {
      slug
      laps
      positions {
        lap
        position
        driver { code name }
        team { name color }
      }
    }
  }
`;

async function main() {
  const started = Date.now();
  const result = await execute({
    schema,
    document: parse(REPLAY_QUERY),
    variableValues: { slug },
    contextValue: { db, session: null },
  });
  const elapsed = Date.now() - started;

  if (result.errors?.length) {
    console.error(result.errors[0]);
    await pool.end();
    process.exit(1);
  }

  const race = (result.data as { race: { positions: unknown[] } | null }).race;

  console.log(`race:      ${slug}`);
  console.log(`positions: ${race?.positions.length ?? 0}`);
  console.log(`queries:   ${count}`);
  console.log(`elapsed:   ${(elapsed / 1000).toFixed(1)}s`);

  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
