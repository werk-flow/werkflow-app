import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeLeftovers, withRunTemporaryFolder } from '../lib/testing/runner/run-temporary-folder';
import { runWatchedUnitTests } from '../lib/testing/runner/unit-run-watchdog';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { UNIT_PROGRESS_DEADLINE_MS, UNIT_RUN_DEADLINE_MS, UNIT_TEST_TIMEOUT_MS } from './unit-test-timeout';

// The hang guard: the preload (bunfig.toml) bounds a bare `bun test`, and the
// flag bounds every file, which the preload alone does not (see the preload).
// Both fire inside the test process, so synchronous work outlives them; the
// watchdog (lib/testing/runner/unit-run-watchdog.ts) bounds the run from here.
//
// One process runs every file, and a `mock.module` stays registered for the
// files after it, so the order of the files is part of the result. Bun takes
// directory order from the file system, which differs between ext4, APFS and
// NTFS; the whole suite therefore runs in one sorted order on every machine.
//
// The run gets its own TMPDIR and fails when it leaves anything there
// (lib/testing/runner/run-temporary-folder.ts).
const repositoryRoot = resolve(import.meta.dir, '..');
const sortedTestFiles = (): string[] =>
  readdirSync(resolve(repositoryRoot, 'lib'), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.test\.(?:ts|tsx|mjs)$/.test(name))
    .map((name) => `./lib/${name}`)
    .sort();
await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const { exitCode, leftovers } = await withRunTemporaryFolder(async () => {
    const { exitCode: testExit, stopped } = await runWatchedUnitTests(
      [
        '--timeout',
        String(UNIT_TEST_TIMEOUT_MS),
        ...(argumentsToRun.length ? argumentsToRun : sortedTestFiles()),
      ],
      { runMs: UNIT_RUN_DEADLINE_MS, progressMs: UNIT_PROGRESS_DEADLINE_MS },
      repositoryRoot,
    );
    if (stopped !== null) console.error(`[unit-watchdog] Stopped: ${stopped}`);
    return testExit;
  });
  if (leftovers.length) console.error(describeLeftovers(leftovers));
  process.exitCode = exitCode;
});
