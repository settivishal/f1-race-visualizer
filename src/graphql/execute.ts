import { execute, parse, validate } from 'graphql';
import { auth } from '@/auth';
import { createContext, type Session } from './context';
import type { TypedDocumentString } from './generated/graphql';
import { schema } from './schema';

/**
 * The in-process entry point, used by server components.
 *
 * This runs graphql.execute() against the schema in the same process: no HTTP
 * request, no serialization round trip, no fetch to our own /api/graphql.
 * Calling your own API over localhost from a server component costs a TCP
 * connection, two serialization passes and possibly a second cold start, all
 * to reach code already loaded in memory — and it makes a page's render depend
 * on the app's own HTTP layer being up, which is a strange thing to be
 * uncertain about from inside that app.
 *
 * So a race page renders as fast as a direct Drizzle query would, while still
 * going through the schema, the resolvers and the loaders. Server components
 * know this one function and not what is behind it.
 *
 * This entry point runs with **no session**, deliberately. Every caller in
 * `src/lib/queries.ts` is inside a `use cache` scope, which cannot read cookies
 * — and a cached page must not vary by who is asking anyway. Admin callers use
 * `executeAsAdmin` below.
 */
export async function executeQuery<TData, TVariables>(
  document: TypedDocumentString<TData, TVariables>,
  variables?: TVariables,
): Promise<TData> {
  return run<TData, TVariables>(document, variables, null);
}

/**
 * The same thing, for a caller that is allowed to be somebody.
 *
 * Kept as a separate function rather than an optional argument, because the
 * difference is not a parameter — it is which of two rules the call has to
 * obey. `executeQuery` is safe inside a `use cache` scope and can never reach
 * an admin field. This one resolves the session from the request's cookies, so
 * it must never be called from a cached scope, and it is the only way to reach
 * a field that calls `requireSession`.
 *
 * Server Actions and admin server components use this. Nothing else should.
 */
export async function executeAsAdmin<TData, TVariables>(
  document: TypedDocumentString<TData, TVariables>,
  variables?: TVariables,
): Promise<TData> {
  const authSession = await auth();
  const userId = authSession?.user?.id;
  const email = authSession?.user?.email;
  const session: Session = userId && email ? { userId, email } : null;

  return run<TData, TVariables>(document, variables, session);
}

async function run<TData, TVariables>(
  document: TypedDocumentString<TData, TVariables>,
  variables: TVariables | undefined,
  session: Session,
): Promise<TData> {
  const parsed = parse(document.toString());

  // Catches a malformed query here rather than as an undefined field deep in a
  // render. The HTTP transport gets this from Yoga for free; this path does not.
  const errors = validate(schema, parsed);
  if (errors.length > 0) throw errors[0];

  const result = await execute({
    schema,
    document: parsed,
    variableValues: variables as Record<string, unknown> | undefined,
    // Fresh per call, so concurrent renders never share a context.
    contextValue: await createContext(session),
  });

  if (result.errors?.length) throw result.errors[0];

  // graphql-js builds every object in the result with `Object.create(null)`.
  // React refuses to serialize a null-prototype object across a boundary —
  // both into a `use cache` entry and into a client component — and the error
  // it raises names neither the field nor the query, so it is worth removing
  // here rather than at each of the places that would hit it.
  //
  // structuredClone is a deep copy, which costs something on the replay
  // payload. It buys results that behave like the plain objects their
  // generated types already claim they are.
  return structuredClone(result.data) as TData;
}
