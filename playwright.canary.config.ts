import { defineConfig } from '@playwright/test';

import { loadEnvLocal } from './tests/golden/support/env';
import { configureRunEnvironment } from './tests/golden/support/run-state';

loadEnvLocal();
configureRunEnvironment('canary');

const quietReporter = process.env.WERKFLOW_QUIET_REPORTER === '1';
const listingTests = process.argv.includes('--list');

// Cloud canary suite (decision D10, docs/plans/platform-hardening.md; ADR
// docs/decisions/0006-testing-architecture.md). A deliberately small battery
// against cloud DEV Supabase and real R2 that proves the behavior only the
// cloud can prove: real provider auth, R2 round trips, cloud Realtime
// delivery, real Resend mail, HIBP password rejection, migration parity.
// Application logic is certified by the local golden/audit batteries; keep
// this suite short (growth rule in docs/technical/testing.md).
//
// IMPORTANT: never run this battery concurrently with the golden or audit
// suite. All three share tests/golden/.artifacts (world.json, auth states).
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
        ['html', { open: 'never', outputFolder: 'tests/canary/.report' }],
      ],
  outputDir: 'tests/canary/.results',
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
