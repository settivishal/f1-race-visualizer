import type { CodegenConfig } from '@graphql-codegen/cli';

/**
 * Types flow Drizzle schema -> Pothos -> GraphQL schema -> here -> components,
 * and no human retypes a shape anywhere along that chain. So the two cannot
 * silently disagree — which is the failure mode that produced v1's Prisma
 * drift, one layer up.
 *
 * The value is in *when* it fires. Renaming or removing a schema field leaves
 * every operation still parsing and still sending; they simply start receiving
 * null, which surfaces as a blank area of the UI in production, possibly weeks
 * later, in a component nobody thought was related. With codegen it is a
 * compile error instead.
 *
 * `graphql-codegen --check` runs in CI, so a resolver change that breaks a
 * query fails the build rather than production.
 */
const config: CodegenConfig = {
  schema: './schema.graphql',
  documents: ['src/**/*.graphql'],
  generates: {
    './src/graphql/generated/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
    },
  },
  ignoreNoDocuments: false,
};

export default config;
