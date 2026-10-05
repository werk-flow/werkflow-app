import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('material saves report the committed identity without a fallible hydration read or permission bypass', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/inventory-material-commit-uuids.ts')],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(status, `${stdout}\n${stderr}`).toBe(0);
});
