import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database, R2 and the network; its own process keeps
// those mocks out of other test files.
test('each invoice mail and alarm goes once, every SEPA renewal is announced 2 days ahead or alarmed, a first debit Checkout announced raises no alarm, and the daily comparison finds what is missing', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/billing-invoice-mails.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
