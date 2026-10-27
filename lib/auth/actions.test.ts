import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The action needs module mocks for identity and the database, which would
// leak into other test files; the fixture runs it in its own process.
test('account deletion refuses any membership row, suspended and ended included, and keeps the profile on a refused Auth deletion', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/account-deletion-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
