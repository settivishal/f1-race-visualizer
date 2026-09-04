import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// WebSocket Pool, not the HTTP driver: ingest needs multi-statement transactions.
// Node has no global WebSocket in every runtime we target, so hand Neon one.
neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { schema };
