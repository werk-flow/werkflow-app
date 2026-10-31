import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The page needs module mocks for identity, cookies, navigation and the
// database, which would leak into other test files; the fixture runs them in its own process.
test('the Kalender shows a field worker only their own row and visits, and another organization nothing', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/calendar-page-access.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
