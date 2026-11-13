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
  // The demo seeder's own helper. CI's SQL job runs the seeder, so the GitHub
  // Actions plugin turns it into an entry without the production mark.
  'lib/security/demo-member-password.ts',
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
    'scripts/migration/*.ts!',
    // Run on a Boat machine by scripts/boat/remote-verify.sh, or by package scripts.
    'scripts/boat/*.ts!',
    // Agent hooks run by path from the agent settings.
    '.claude/hooks/*.ts!',
    'playwright.audit.config.ts!',
    'playwright.canary.config.ts!',
    'tests/golden/global-setup.ts!',
    'tests/golden/global-teardown.ts!',
    'tests/golden/support/discovery-reporter.ts!',
    'tests/**/*.spec.ts!',
    // Loaded by directory from tests/audit/support/acceptance-sets.ts, never imported.
    'tests/audit/support/acceptance-sets/*.ts!',
    'tests/ui-contracts/fixture.tsx!',
    'tests/ui-contracts/playwright.config.ts!',
    // Substituted for product modules by the component-contract bundler.
    'tests/ui-contracts/*boundar*.{ts,tsx}!',
    // The E1 ↔ E2a seam (werk-flow/werkflow-planning#15): the article price
    // reader and the line arithmetic rule exist before E2a's offers import
    // them. Remove this entry with the first production import.
    'lib/inventory/{article-prices,line-amount}.ts!',
    // The Leistung price reader (werk-flow/werkflow-planning#379) exists before
    // the offer calculation imports it. Remove this entry with that import.
    'lib/price-catalog/leistung-prices.ts!',
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
  // tailwindcss is imported by app/globals.css, which knip does not compile; typescript7's tsc
  // runs behind `bun scripts/heavy.ts --` in the `typecheck` script, where knip reads no binary.
  ignoreDependencies: ['supabase', 'tailwindcss', 'typescript7'],
  // util-linux's flock holds the machine-wide heavy slots (lib/testing/runner/heavy-slot.ts);
  // T3 Code's CLI wakes the thread of a notified run (lib/testing/notified-run.ts);
  // POSIX mkfifo lets its test wait on the wake itself (lib/testing/notified-run.test.ts);
  // the runner's openssl reads its agent's certificate expiry (scripts/date-lookahead-plan.ts);
  // macOS xattr marks a file the Boat pack must strip (lib/testing/boat/verify-on-boat.test.ts).
  ignoreBinaries: ['flock', 'mkfifo', 'openssl', 't3', 'xattr'],
};

export default config;
