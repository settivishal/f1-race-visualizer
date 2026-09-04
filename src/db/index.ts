import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';

let instance: ReturnType<typeof connect> | undefined;

function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  return drizzle(new Pool({ connectionString }), { schema });
}

export function getDb() {
  return (instance ??= connect());
}

export { schema };
