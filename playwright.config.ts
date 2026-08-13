import { defineConfig } from '@playwright/test';

import { loadEnvLocal } from './tests/golden/support/env';

loadEnvLocal();

// Golden-gate harness (docs/plans/phase-1-build-roadmap.md). Runs the GG-XX
// business scenarios against a locally running app and the live Supabase
// project using disposable, organization-isolated fixture data.
export default defineConfig({
  testDir: './tests/golden',
  globalSetup: './tests/golden/global-setup',
  globalTeardown: './tests/golden/global-teardown',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // The world is shared, mutable state; gates run serially by design.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/golden/.report' }]],
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
