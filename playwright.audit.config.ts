import { defineConfig } from '@playwright/test';

import { loadEnvLocal } from './tests/golden/support/env';
import { configureRunEnvironment } from './tests/golden/support/run-state';

loadEnvLocal();
configureRunEnvironment('audit');

const quietReporter = process.env.WERKFLOW_QUIET_REPORTER === '1';
const listingTests = process.argv.includes('--list');

// Wave-audit battery (docs/plans/wave-1-audit.md, wave-2-audit.md, …). Runs
// the exhaustive user-flow audit specs against a locally running app and the
// dev Supabase project, reusing the golden harness (world seeder, steps, db
// helpers). testDir covers every wave; scope runs with --grep @AUDIT-W<N>
// (or a slice tag like @AUDIT-W2-P1-13). A no-grep run executes all waves in
// ONE shared world, which is why fixture-date partitions are unique across
// waves (W1: +20…+69, W2: +70…, see the wave audit docs).
//
// IMPORTANT: never run this battery and the golden suite at the same time.
// Both configs share tests/golden/.artifacts (world.json, auth states) and
// the global setup destroys leftover worlds from "earlier" runs — a
// concurrent run would clobber the other's world.
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
  // Audit specs share one world per run; sessions run serially by design.
  workers: 1,
  retries: 0,
  // Preserve the first useful failure instead of emitting dependent cascades.
  maxFailures: 1,
  reporter: listingTests
    ? 'list'
    : [
        ...(quietReporter ? [] : ([['list']] as const)),
        ['./tests/golden/support/run-reporter.ts'],
        ['html', { open: 'never', outputFolder: 'tests/audit/.report' }],
      ],
  outputDir: 'tests/audit/.results',
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
