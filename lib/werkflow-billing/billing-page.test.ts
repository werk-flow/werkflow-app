import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("only the organization's Admin reads WerkFlow's invoices and subscription, opens an original or cancels, and a cancellation can be taken back until the period ends", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/werkflow-billing-page-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
