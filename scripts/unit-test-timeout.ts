/** The per-test hang guard of a unit test (scripts/unit-test-preload.ts, scripts/run-unit-tests.ts). */
export const UNIT_TEST_TIMEOUT_MS = 60_000;

/**
 * The runner's watchdog (lib/testing/runner/unit-run-watchdog.ts): it stops a run in which no test
 * starts for twice the per-test bound, which Bun's timer misses while a test blocks its event loop,
 * and a run that outlives several times the full suite's duration on a slow workstation.
 */
export const UNIT_PROGRESS_DEADLINE_MS = 2 * UNIT_TEST_TIMEOUT_MS;
export const UNIT_RUN_DEADLINE_MS = 20 * 60_000;
