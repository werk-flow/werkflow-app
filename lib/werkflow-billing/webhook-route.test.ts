import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database and two handlers; its own process keeps
// those mocks out of other test files.
test('a Stripe signal is refused before any record unless signed, and handled at most once', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/stripe-webhook-route.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
