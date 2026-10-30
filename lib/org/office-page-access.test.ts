import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The pages need module mocks for identity, cookies, navigation and the
// database, which would leak into other test files; the fixture runs them in its own process.
test('office pages refuse a field worker and never show another organization’s request or customer', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/office-page-access.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
