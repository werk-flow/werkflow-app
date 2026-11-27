import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('only Admin and Büro email a sent offer revision, its own filed PDF once per press, and a later revision is a new delivery', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/offer-delivery-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
