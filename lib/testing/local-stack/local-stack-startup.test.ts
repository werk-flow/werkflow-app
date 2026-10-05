import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('cold startup waits for actual service health, fails missing containers and honors cancellation', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../fixtures/local-stack-startup.ts')],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
});
