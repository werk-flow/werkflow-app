import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

// A unit test asserts no duration, so one hang guard covers every test. Tests
// that read the whole source tree take two seconds on a quiet workstation and
// took up to thirteen right after a build, against Bun's default of five.
const HANG_GUARD_MS = 60_000;

await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const child = Bun.spawn(
    [
      process.execPath,
      'test',
      '--timeout',
      String(HANG_GUARD_MS),
      ...(argumentsToRun.length ? argumentsToRun : ['lib']),
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  process.exitCode = await child.exited;
});
