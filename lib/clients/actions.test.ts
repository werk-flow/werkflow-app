import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions need module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs them in its own process.
test('contact and work-site actions admit only managers, never reach another organization, and save a primary row in one write', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/client-relation-action-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
