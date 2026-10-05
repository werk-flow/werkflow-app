import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('Playwright cannot delete a world before parent evidence qualification; failed qualification and cleanup preserve ownership', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../fixtures/browser-world-finalization.ts')],
    {
      cwd: resolve(import.meta.dir, '../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
