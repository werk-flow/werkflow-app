import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture mocks identity, navigation and the database; its own process keeps them out of other test files.
test("a cancelled Checkout returns where it started and never offers the active organization's subscription for a further one", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/checkout-cancel-return.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
