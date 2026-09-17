import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('membership reads share only a request and observe creation, role, revocation and lifecycle changes', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/membership-freshness.ts')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
