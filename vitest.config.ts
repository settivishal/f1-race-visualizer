import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json, so tests import the same way
  // the application does.
  resolve: {
    tsconfigPaths: true,
    // graphql ships both ESM and CJS entries, and loading one of each gives two
    // copies of its classes in the same process — `instanceof` then fails and
    // execute() rejects a schema built by the other copy. Only the tests hit
    // this: Next and tsx each resolve one way throughout.
    dedupe: ['graphql'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Pothos is externalised by default and would then require graphql's CJS
    // entry while the test file imports its ESM one. Inlining it puts both on
    // the same copy, which is what dedupe above can then act on.
    server: { deps: { inline: [/@pothos\//, /^graphql$/] } },
  },
});
