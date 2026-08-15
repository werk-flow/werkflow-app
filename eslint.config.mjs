import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Playwright writes generated report/trace bundles on every golden-gate
    // run; without these ignores, lint walks thousands of generated files.
    "tests/golden/.report/**",
    "tests/golden/.results/**",
    "tests/golden/.artifacts/**",
    "tests/audit/.report/**",
    "tests/audit/.results/**",
  ]),
]);

export default eslintConfig;
