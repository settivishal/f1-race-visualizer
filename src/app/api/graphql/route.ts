import { costLimitPlugin } from '@escape.tech/graphql-armor-cost-limit';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
// Aliased: it is an envelop plugin, not a React hook, and the shared `use`
// prefix is all the rules-of-hooks lint rule looks at.
import { useDisableIntrospection as disableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { createYoga } from 'graphql-yoga';
import { createContext } from '@/graphql/context';
import { schema } from '@/graphql/schema';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * /api/graphql is public and unauthenticated, which is correct for a public
 * site and means anyone can send arbitrary queries. An open schema is an
 * unusual exposure because the client chooses the *shape* of the server's
 * work, and two attacks follow directly from this schema.
 *
 * The limits are on in every environment, not production only. A limit that is
 * off in development is one nobody notices they have broken until it rejects a
 * legitimate query in production.
 */
const yoga = createYoga<{ request: Request }>({
  schema,
  plugins: [
    // The schema has a cycle: Race -> Meeting -> races -> Meeting -> ...
    // A short query nests it twenty deep and buys exponential work for nothing.
    // Real queries here nest three or four levels; ten is generous and closes
    // the class.
    maxDepthPlugin({ n: 10 }),
    // `race { replay }` is ~1,400 rows and a pivot — legitimate as a page load,
    // cheap to abuse when aliased fifty times in one request.
    costLimitPlugin({ maxCost: 5000 }),
    // Introspection is not itself a breach, since admin fields will still check
    // the session. It is reconnaissance, and there is no reason to serve a map
    // of every type and mutation to the public.
    ...(isDev ? [] : [disableIntrospection()]),
  ],
  // Fresh per request: the loaders' cache must not outlive the request it was
  // built for.
  context: createContext,
  graphqlEndpoint: '/api/graphql',
  // Route handlers deal in the Web Request/Response APIs, which is what Yoga
  // already speaks — see node_modules/next/dist/docs/01-app/01-getting-started/
  // 15-route-handlers.md.
  fetchAPI: { Response },
  // A full query IDE against a real database is one of the better parts of
  // working with GraphQL, and verification step 3 uses it to compare GraphiQL
  // output against a server component's render. In production it is only
  // reconnaissance.
  graphiql: isDev,
});

// Wrapped rather than exported directly: Next 16 type-checks route handlers
// against (NextRequest, context), and Yoga's instance is callable with a
// different pair. Its .fetch is the Web-standard entry point and is what the
// handler actually wants.
export function GET(request: Request) {
  return yoga.fetch(request);
}

export function POST(request: Request) {
  return yoga.fetch(request);
}
