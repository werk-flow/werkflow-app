import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database, Stripe and two handlers; its own process keeps
// those mocks out of other test files.
test('an invoice signal that arrived before its organization existed runs once the organization is created', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/signals-before-organization.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
