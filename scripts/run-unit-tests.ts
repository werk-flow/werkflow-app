import { resolve } from 'node:path';
import { runWatchedUnitTests } from '../lib/testing/runner/unit-run-watchdog';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { UNIT_PROGRESS_DEADLINE_MS, UNIT_RUN_DEADLINE_MS, UNIT_TEST_TIMEOUT_MS } from './unit-test-timeout';

// The hang guard: the preload (bunfig.toml) bounds a bare `bun test`, and the
// flag bounds every file, which the preload alone does not (see the preload).
// Both fire inside the test process, so synchronous work outlives them; the
// watchdog (lib/testing/runner/unit-run-watchdog.ts) bounds the run from here.
await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const { exitCode, stopped } = await runWatchedUnitTests(
    ['--timeout', String(UNIT_TEST_TIMEOUT_MS), ...(argumentsToRun.length ? argumentsToRun : ['lib'])],
    { runMs: UNIT_RUN_DEADLINE_MS, progressMs: UNIT_PROGRESS_DEADLINE_MS },
    resolve(import.meta.dir, '..'),
  );
  if (stopped !== null) console.error(`[unit-watchdog] Stopped: ${stopped}`);
  process.exitCode = exitCode;
});
