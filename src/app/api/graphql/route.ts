import { createYoga } from 'graphql-yoga';
import { createContext } from '@/graphql/context';
import { schema } from '@/graphql/schema';

const isDev = process.env.NODE_ENV !== 'production';

const yoga = createYoga<{ request: Request }>({
  schema,
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

export { yoga as GET, yoga as POST };
