import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('actual responsibility reads share only a GET lifetime and cancellation never crosses requests', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/read-request-lifetime.ts')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
