import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions need module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs them in its own process.
test('invite actions validate input first, admit only managers of the active organization, and never reach a foreign invite', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/invite-action-boundaries-uuids.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
