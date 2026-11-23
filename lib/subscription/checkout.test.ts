import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions need module mocks for identity, navigation, the database and
// Stripe, which would leak into other test files; the fixture runs them in
// its own process.
test('only an Admin subscribes an organization, and only a paid reservation creates one', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/subscription-checkout-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
