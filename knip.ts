import type { KnipConfig } from 'knip';

// Unused files, exports and dependencies fail `bun run unused:check`
// (static:unused, pre-Wave-3 step 2, 2026-09-14). Step 3 removed about 140
// dead exports and seven dead files by hand; this gate keeps that state.
//
// `unused:check` runs knip twice. The first pass reads the whole graph, unit
// tests included. The second pass, `bun run unused:production`
// (`knip --production`), drops the unit tests and their fixtures as
// consumers, so an export that only a unit test imports is reported as dead.
// A deliberate test seam carries `@internal` in its JSDoc, which knip skips
// in production mode; lib/conventions/test-only-exports.test.ts lists every
// seam with its reason. A trailing `!` marks a production entry or project
// file.
const production = process.argv.includes('--production');

// The tooling (harness, docs and convention checks, lint rules, scripts and
// browser tests) consumes product exports in both passes; its own unused
// exports are the first pass's business.
const TOOLING = [
  'lib/testing/**',
  'lib/docs/**',
  'lib/conventions/**',
  'lib/ui/{action-prechecks,dialog-discovery}.ts',
  'lib/security/supabase-project-checks.ts',
  'eslint-rules/**',
  'scripts/**',
  'tests/**',
];

const config: KnipConfig = {
  // The Next.js plugin supplies app/** routes and layouts as entries; the
  // entries below are the runners Next does not see.
  entry: [
    'lib/**/*.test.{ts,tsx,mjs}',
    // Spawned by path from unit tests and the runner, never imported.
    'lib/testing/runner/file-lock-worker.ts!',
    'lib/testing/fixtures/*.{ts,tsx}',
    'scripts/*.ts!',
    // Agent hooks run by path from the agent settings (the prepared ones from their test).
    '.claude/hooks/*.ts!',
    'playwright.audit.config.ts!',
    'playwright.canary.config.ts!',
    'tests/golden/global-setup.ts!',
    'tests/golden/global-teardown.ts!',
    'tests/golden/support/discovery-reporter.ts!',
    'tests/**/*.spec.ts!',
    'tests/ui-contracts/fixture.tsx!',
    'tests/ui-contracts/playwright.config.ts!',
    // Substituted for product modules by the component-contract bundler.
    'tests/ui-contracts/*boundar*.{ts,tsx}!',
  ],
  project: ['**/*.{ts,tsx,mjs}!', '!lib/**/*.test.{ts,tsx,mjs}!', '!lib/testing/fixtures/**!'],
  // Deno functions have their own import graph; the transcript folder is
  // research bookkeeping outside the product.
  ignore: ['supabase/functions/**', 'temporary-transcripts/**'],
  ignoreIssues: {
    // The shadcn registry keeps its full component API (owner decision, CL-D4).
    'components/ui/**': ['exports', 'types', 'duplicates'],
    // Generated from the DEV schema; every table type is exported by design.
    'lib/supabase/database.types.ts': ['exports', 'types'],
    // A boundary module mirrors the export surface of the module it replaces.
    'tests/ui-contracts/*boundar*.{ts,tsx}': ['exports', 'types'],
    ...(production
      ? Object.fromEntries(TOOLING.map((pattern) => [pattern, ['files', 'exports', 'types', 'duplicates']]))
      : {}),
  },
  // Type-only exports are part of the gate since 2026-09-15 (owner decision, step 2).
  // The pinned Supabase CLI runs through bunx inside scripts/generate-supabase-types.ts;
  // tailwindcss is imported by app/globals.css, which knip does not compile.
  ignoreDependencies: ['supabase', 'tailwindcss'],
};

export default config;
