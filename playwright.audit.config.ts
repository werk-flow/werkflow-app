import { defineConfig } from '@playwright/test';
import { browserRunPaths } from './lib/testing/run-paths';

import { loadEnvLocal } from './tests/golden/support/env';
import { configureRunEnvironment, currentRunKey } from './tests/golden/support/run-state';

loadEnvLocal();
configureRunEnvironment('audit');

const runPaths = browserRunPaths(__dirname, currentRunKey());

const quietReporter = process.env.WERKFLOW_QUIET_REPORTER === '1';
const listingTests = process.argv.includes('--list');

// Wave-audit battery (docs/plans/wave-1-audit.md, wave-2-audit.md, …). Runs
// the exhaustive user-flow audit specs against a locally running app and the
// selected Supabase target, local by default, reusing the golden harness (world seeder, steps, db
// helpers). testDir covers every wave; scope runs with --grep @AUDIT-W<N>
// (or a slice tag like @AUDIT-W2-P1-13). A no-grep run executes all waves in
// one owned world per spec file. Stages inside each file remain serial;
// the audit fixture retires the preceding successful file's world.
//
// Each invocation owns its state and output files. The group runner invokes
// independent files separately and continues after an unrelated group fails.
// The workspace lock still serializes app/backend use on this host.
export default defineConfig({
  testDir: './tests/audit',
  globalSetup: './tests/golden/global-setup',
  globalTeardown: './tests/golden/global-teardown',
  // Measured per-scenario budgets: Stage C (2026-08-29) established the
  // target-keyed policy. The A5 qualification matrix then measured above the
  // former 180 s local envelope during P1-20 regression testing (2026-08-31),
  // so local audits use 240 s. Cloud keeps its measured 300 s envelope. Do not
  // add per-test setTimeout overrides; update the target budget with evidence.
  timeout: process.env.WERKFLOW_TEST_TARGET === 'cloud' ? 300_000 : 240_000,
  expect: { timeout: 10_000 },
  // One active world at a time; file groups are isolated by audit fixtures.
  workers: 1,
  retries: 0,
  // Preserve the first useful failure instead of emitting dependent cascades.
  maxFailures: 1,
  reporter: listingTests
    ? 'list'
    : [
        ...(quietReporter ? [] : ([['list']] as const)),
        ['./tests/golden/support/run-reporter.ts'],
        ['html', { open: 'never', outputFolder: runPaths.report }],
      ],
  outputDir: runPaths.results,
  use: {
    baseURL: process.env.GOLDEN_BASE_URL ?? 'http://localhost:3000',
    // Missing controls must fail at the action, not consume a whole scenario.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
