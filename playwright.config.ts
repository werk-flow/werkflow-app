import { defineConfig } from '@playwright/test';

import { loadEnvLocal } from './tests/golden/support/env';
import { configureRunEnvironment } from './tests/golden/support/run-state';

loadEnvLocal();
configureRunEnvironment('golden');

const quietReporter = process.env.WERKFLOW_QUIET_REPORTER === '1';
const listingTests = process.argv.includes('--list');

// Golden-gate harness (docs/plans/phase-1/gates.md). Runs the GG-XX
// business scenarios against a locally running app and the live Supabase
// project using disposable, organization-isolated fixture data.
export default defineConfig({
  testDir: './tests/golden',
  globalSetup: './tests/golden/global-setup',
  globalTeardown: './tests/golden/global-teardown',
  // Measured per-scenario budgets (Stage C, 2026-08-29): the slowest test in
  // the frozen Stage B local certifications measured 28 s (Golden) / 55 s
  // (audit), so the 180 s local default carries >3x headroom and no scenario
  // needs a per-test override. Cloud-target runs (wave-end, D11) measured up
  // to ~2-3x slower under provider latency — they get 300 s (the budget the
  // A5 cloud incident established, test-incident-log.md 2026-08-27). Do not
  // add per-test setTimeout overrides without new measured evidence.
  timeout: process.env.WERKFLOW_TEST_TARGET === 'cloud' ? 300_000 : 180_000,
  expect: { timeout: 10_000 },
  // The world is shared, mutable state; gates run serially by design.
  workers: 1,
  retries: 0,
  // Later shared-world results are not meaningful after the first failure.
  maxFailures: 1,
  reporter: listingTests
    ? 'list'
    : [
        ...(quietReporter ? [] : ([['list']] as const)),
        ['./tests/golden/support/run-reporter.ts'],
        ['html', { open: 'never', outputFolder: 'tests/golden/.report' }],
      ],
  outputDir: 'tests/golden/.results',
  use: {
    baseURL: process.env.GOLDEN_BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 900 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
