import { defineConfig } from '@playwright/test';
import { browserRunPaths } from './lib/testing/run-paths';

import { loadEnvLocal } from './tests/golden/support/env';
import { configureRunEnvironment, currentRunKey } from './tests/golden/support/run-state';

loadEnvLocal();
configureRunEnvironment('canary');

const runPaths = browserRunPaths(__dirname, currentRunKey());

const quietReporter = process.env.WERKFLOW_QUIET_REPORTER === '1';
const listingTests = process.argv.includes('--list');

// Cloud canary suite (decision D10, docs/plans/phase-1/consolidation-2026-08/platform-hardening.md; ADR
// docs/decisions/0006-testing-architecture.md). A deliberately small battery; current execution and acceptance rules: decision 0007 (docs/decisions/0007-independent-test-groups.md)
// against cloud DEV Supabase and real R2 that proves the behavior only the
// cloud can prove: real provider auth, R2 round trips, cloud Realtime
// delivery, real Resend mail, HIBP password rejection, migration parity.
// Application logic is certified by the local golden/audit batteries; keep
// this suite short (growth rule in docs/technical/testing.md).
//
// Files belong to this run. The workspace lock still serializes app/backend use.
export default defineConfig({
  testDir: './tests/canary',
  globalSetup: './tests/golden/global-setup',
  globalTeardown: './tests/golden/global-teardown',
  // The canary is pinned to the cloud target; it keeps the measured 300 s
  // cloud envelope directly (see playwright.config.ts for the evidence).
  timeout: 300_000,
  expect: { timeout: 10_000 },
  // The world is shared, mutable state; canary checks run serially by design.
  workers: 1,
  retries: 0,
  // Later shared-world results are not meaningful after the first failure.
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
    // Provider checks retain their own waits; locator actions stay bounded.
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    screenshot: 'only-on-failure',
    trace: process.env.WERKFLOW_RETAIN_PERFORMANCE_TRACE === '1' ? 'on' : 'retain-on-failure',
  },
});
