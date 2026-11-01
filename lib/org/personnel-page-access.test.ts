import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The pages need module mocks for identity, cookies, navigation and the
// database, which would leak into other test files; the fixture runs them in its own process.
test('Mitarbeiter pages refuse a field worker in every organization and never show another organization’s people', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/personnel-page-access.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
