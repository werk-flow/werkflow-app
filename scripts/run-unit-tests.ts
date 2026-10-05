import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

await withWorkspaceTestLock({ operation: 'unit suite' }, async () => {
  const argumentsToRun = process.argv.slice(2);
  const child = Bun.spawn([process.execPath, 'test', ...(argumentsToRun.length ? argumentsToRun : ['lib'])], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.exitCode = await child.exited;
});
