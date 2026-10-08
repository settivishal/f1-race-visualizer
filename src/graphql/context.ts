import { GraphQLError } from 'graphql';
import { getDb, type Db } from '@/db';
import { createLoaders, type Loaders } from './loaders';

export type { Db };

/**
 * Who is asking. Null for every public request, which is almost all of them.
 *
 * This is the layer that guards *data*. `/api/graphql` is a single public URL
 * serving public and admin operations alike, so no route-level rule can tell
 * them apart — the proxy sees one path. An admin field therefore checks this
 * itself; see `requireSession` below.
 */
export type Session = { userId: string; email: string } | null;

export type Context = {
  db: Db;
  loaders: Loaders;
  session: Session;
};

/**
 * Called by every admin field before it touches anything.
 *
 * Throwing rather than returning null is deliberate: a field that returns null
 * to an unauthenticated caller is indistinguishable from a field with no data,
 * so a missing guard would look exactly like an empty database.
 *
 * A `GraphQLError` rather than a plain `Error`, for two reasons. Yoga masks
 * unexpected errors — a plain Error reaches the client as "Unexpected error."
 * with the original and its stack attached in development, which both hides the
 * real reason and prints absolute paths from this machine. A GraphQLError is
 * treated as intended output: the message survives, and nothing else is
 * attached. "You are not allowed" is a normal answer, not a crash.
 */
export function requireSession(ctx: Context): NonNullable<Session> {
  if (!ctx.session) {
    throw new GraphQLError('Unauthorized', {
      extensions: { code: 'UNAUTHORIZED', http: { status: 401 } },
    });
  }
  return ctx.session;
}

/**
 * The session is passed in rather than read here, and that is load-bearing.
 *
 * Resolving it inside this function would mean calling Auth.js's `auth()`,
 * which reads cookies. `executeQuery` builds a context, and every function in
 * `src/lib/queries.ts` calls `executeQuery` from inside a `use cache` scope —
 * and a cached scope cannot touch `cookies()`, `headers()` or `searchParams`.
 * The restriction follows the call stack, so a cookie read here would break
 * every cached public read on the site.
 *
 * That constraint points at the right design rather than fighting it. A cached
 * page **must not** depend on who is asking, or the cache entry would be wrong
 * for the next visitor. Public reads therefore run with no session, which is
 * not a limitation but the requirement stated as a type.
 *
 * Callers that do have a request — the Yoga route, and the admin path in
 * `execute.ts` — resolve the session themselves and hand it in.
 *
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
export async function createContext(session: Session = null): Promise<Context> {
  const db = getDb();
  return { db, loaders: createLoaders(db), session };
}
