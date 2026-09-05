import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json, so tests import the same way
  // the application does.
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
