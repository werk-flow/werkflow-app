import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The action needs module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs it in its own process.
test('a role change decided on a membership that changed before the write refuses as member_changed', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/member-role-stale-write.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
