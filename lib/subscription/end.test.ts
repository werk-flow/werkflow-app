import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database and Stripe; its own process keeps the mocks out of other test files.
test('deleting an organization or an account cancels its Stripe subscription once, before anything is deleted', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/subscription-end-on-deletion.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
