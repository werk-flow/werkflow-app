import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('actual account actions enforce lifecycle visibility and atomic OTP results', async () => {
  // Process isolation prevents framework/provider mocks leaking into other tests.
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/account-boundaries.ts')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
