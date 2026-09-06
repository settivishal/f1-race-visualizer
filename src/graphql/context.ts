import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { getDb } from '@/db';
import type * as dbSchema from '@/db/schema';
import { createLoaders, type Loaders } from './loaders';

// Driver-agnostic on purpose: Neon in production, PGlite under test. The
// resolvers use no driver-specific API, and typing this to Neon would have
// meant the test suite exercising a cast rather than the real signature.
export type Db = PgDatabase<PgQueryResultHKT, typeof dbSchema>;

export type Context = {
  db: Db;
  loaders: Loaders;
  // Auth.js arrives in M3. Until then this is always null, and no field reads
  // it: an admin field that cannot be authorised should not exist yet, so
  // ingestRuns and the mutations are deliberately absent from the schema
  // rather than present and unguarded.
  session: null;
};

/**
 * One context per request, and one set of loaders with it. Never
 * module-level: a loader's cache has no invalidation and no expiry, so a
 * process-lifetime loader would serve an edited driver's old name until the
 * instance recycled — a staleness bug and an unbounded cache in one. Scoping
 * it to the request makes the cache lifetime exactly the window in which the
 * data cannot change anyway, so it is correct because it is short-lived rather
 * than because anything invalidates it.
 *
 * executeQuery() calls this too, so a server render gets its own loaders and
 * never shares them with a concurrent render.
 */
export async function createContext(): Promise<Context> {
  const db = getDb();
  return { db, loaders: createLoaders(db), session: null };
}
