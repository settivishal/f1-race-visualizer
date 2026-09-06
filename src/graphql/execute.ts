import { execute, parse, validate } from 'graphql';
import { createContext } from './context';
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
 */
export async function executeQuery<TData, TVariables extends Record<string, unknown> = Record<string, never>>(
  document: string,
  variables?: TVariables,
): Promise<TData> {
  const parsed = parse(document);

  // Catches a malformed query here rather than as an undefined field deep in a
  // render. The HTTP transport gets this from Yoga for free; this path does not.
  const errors = validate(schema, parsed);
  if (errors.length > 0) throw errors[0];

  const result = await execute({
    schema,
    document: parsed,
    variableValues: variables,
    // Fresh per call, so concurrent renders never share a context.
    contextValue: await createContext(),
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
