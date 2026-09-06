import { getDb } from '@/db';

export type Db = ReturnType<typeof getDb>;

export type Context = {
  db: Db;
  // Auth.js arrives in M3. Until then this is always null, and no field reads
  // it: an admin field that cannot be authorised should not exist yet, so
  // ingestRuns and the mutations are deliberately absent from the schema
  // rather than present and unguarded.
  session: null;
};

/**
 * One context per request, and — once loaders land — one set of loaders with
 * it. Never module-level: a loader's cache has no invalidation, so its
 * lifetime has to be short enough that the data cannot change inside it.
 *
 * executeQuery() calls this too, so a server render gets its own context and
 * never shares a cache with a concurrent render.
 */
export async function createContext(): Promise<Context> {
  return { db: getDb(), session: null };
}
