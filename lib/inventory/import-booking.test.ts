import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the CSV import reports rows without a Lager, fails rows whose match read failed, and books matched rows as receipts', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/inventory-csv-import.ts')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
});
