import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the health endpoint hides itself without its token and names only the failing check', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/health-http.ts')],
    {
      cwd: resolve(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
