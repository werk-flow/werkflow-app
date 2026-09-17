import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('authorized layout does not wait for optional runtime state or seed false empty values', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/app-layout-runtime.tsx')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
