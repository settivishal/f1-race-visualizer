import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let instance: ReturnType<typeof connect> | undefined;

// WebSocket Pool, not Neon's HTTP driver: the HTTP driver sends each statement
// as an independent request and so cannot hold a multi-statement transaction,
// which the ingest pipeline needs. Node has supplied a global WebSocket since
// 22.4, so no polyfill is required — see engines in package.json.
function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return drizzle(new Pool({ connectionString }), { schema });
}

// Built on first query, not on import. Next evaluates route modules while
// collecting page data at build time, where no database is reachable and none
// is needed — a connection opened there would fail a build over a value that
// only matters at runtime.
export function getDb() {
  return (instance ??= connect());
}

export { schema };
