import { costLimitPlugin } from '@escape.tech/graphql-armor-cost-limit';
import { maxDepthPlugin } from '@escape.tech/graphql-armor-max-depth';
// Aliased: it is an envelop plugin, not a React hook, and the shared `use`
// prefix is all the rules-of-hooks lint rule looks at.
import { useDisableIntrospection as disableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import { createYoga } from 'graphql-yoga';
import { sessionFromAuth } from '@/graphql/execute';
import { createContext } from '@/graphql/context';
import { clientKey, consume } from '@/lib/rate-limit';
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
  //
  // The session is resolved here because this is where the cookies are. A
  // logged-out caller gets `null` and every admin field rejects them — which is
  // the only thing standing between this URL and the mutations, since one
  // endpoint serves both public and admin operations and no route rule can
  // separate them.
  context: async () => createContext(await sessionFromAuth()),
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
/**
 * Depth and cost limits govern the shape of a query; this governs how many.
 * 60 in a burst refilling at 2/second is generous for the command palette,
 * which sends one debounced request per pause in typing, and closes the gap
 * that made a public endpoint a free way to run a thousand queries a minute.
 */
const GRAPHQL_BUCKET = { capacity: 60, refillPerSecond: 2 };

async function handle(request: Request) {
  if (!(await consume(clientKey(request.headers, 'graphql'), GRAPHQL_BUCKET))) {
    return new Response(
      JSON.stringify({ errors: [{ message: 'Too many requests' }] }),
      { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' } },
    );
  }
  return yoga.fetch(request);
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
