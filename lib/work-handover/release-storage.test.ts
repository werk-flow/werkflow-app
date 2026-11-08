import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The release needs module mocks for identity, cookies, storage and the database,
// which would leak into other test files; the fixture runs it in its own process.
test('a refused handover release removes only its own package object, never the registered one, and a replay answers with the registered package', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/work-handover-release-storage.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
