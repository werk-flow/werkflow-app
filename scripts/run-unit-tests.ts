import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

// The hang guard lives in scripts/unit-test-preload.ts (bunfig.toml), so a
// bare `bun test` has it too.
await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const child = Bun.spawn([process.execPath, 'test', ...(argumentsToRun.length ? argumentsToRun : ['lib'])], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await child.exited;
});
