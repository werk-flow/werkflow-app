import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('item saves and unplanned takes are one database call with server-resolved scope, and refusals reach the caller', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/inventory-atomic-writes.ts')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
});
