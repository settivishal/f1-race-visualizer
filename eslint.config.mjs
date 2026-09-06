import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import oxlint from "eslint-plugin-oxlint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Turns off every rule oxlint already enforces (read from .oxlintrc.json), so
  // `pnpm lint` reports each problem once. Must stay last.
  ...oxlint.buildFromOxlintConfigFile(".oxlintrc.json"),
]);

export default eslintConfig;
