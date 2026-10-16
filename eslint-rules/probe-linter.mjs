import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

// Lint probes lint planted sources under a file path, most of them paths that
// exist only in memory. The TypeScript project service finds no such file on
// disk, so the typed probe linter types it in the service's default project,
// which reads the same tsconfig.json. A probe under an existing path checks a
// path-scoped exception of a syntax rule; it is linted without type
// information, because the default project refuses a file the service already
// knows and the type-aware rules carry no path exception.
const repositoryRoot = resolve(import.meta.dirname, '..');
const IN_MEMORY_DEPTHS = 6;
const inMemoryProbeGlobs = Array.from(
  { length: IN_MEMORY_DEPTHS },
  (_, depth) => `${'*/'.repeat(depth)}*.{ts,tsx}`,
);
const TYPE_AWARE_RULES = [
  '@typescript-eslint/switch-exhaustiveness-check',
  '@typescript-eslint/no-floating-promises',
];
const typedFiles = { files: ['**/*.{ts,tsx}'], ignores: ['supabase/functions/**'] };

/**
 * ESLint with the repository's effective configuration for probes: `lintText`
 * types an in-memory path with the type-aware rules and lints an existing path
 * without them.
 */
export function createProbeLinter() {
  const inMemory = new ESLint({
    overrideConfig: {
      ...typedFiles,
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: inMemoryProbeGlobs,
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 1_000,
          },
        },
      },
    },
  });
  const existing = new ESLint({
    overrideConfig: {
      ...typedFiles,
      languageOptions: { parserOptions: { projectService: false } },
      rules: Object.fromEntries(TYPE_AWARE_RULES.map((rule) => [rule, 'off'])),
    },
  });
  const linterFor = (filePath) =>
    filePath && existsSync(resolve(repositoryRoot, filePath)) ? existing : inMemory;
  return {
    /** @type {ESLint['lintText']} */
    lintText: (source, options) => linterFor(options?.filePath).lintText(source, options),
    /** @type {ESLint['calculateConfigForFile']} */
    calculateConfigForFile: (filePath) => linterFor(filePath).calculateConfigForFile(filePath),
  };
}
