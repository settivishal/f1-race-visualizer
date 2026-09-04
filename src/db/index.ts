import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// WebSocket Pool, not the HTTP driver: ingest needs multi-statement transactions.
// Node has no global WebSocket in every runtime we target, so hand Neon one.
neonConfig.webSocketConstructor = ws;

let instance: ReturnType<typeof connect> | undefined;

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
