import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { UNIT_TEST_TIMEOUT_MS } from './unit-test-timeout';

// The hang guard: the preload (bunfig.toml) bounds a bare `bun test`, and the
// flag bounds every file, which the preload alone does not (see the preload).
await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const child = Bun.spawn(
    [
      process.execPath,
      'test',
      '--timeout',
      String(UNIT_TEST_TIMEOUT_MS),
      ...(argumentsToRun.length ? argumentsToRun : ['lib']),
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  process.exitCode = await child.exited;
});
