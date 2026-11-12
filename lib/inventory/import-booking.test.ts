import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the CSV import stages every row in order, refuses an empty or unknown unit, and books a batch by its id only', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/inventory-csv-import.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
});
