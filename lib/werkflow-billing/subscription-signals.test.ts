import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database; its own process keeps the mock out of other test files.
test('a checkout or subscription signal records Stripe re-read state for the organization its customer names', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/stripe-subscription-signals.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
