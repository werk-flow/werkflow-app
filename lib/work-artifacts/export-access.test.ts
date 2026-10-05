import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The export needs module mocks for identity, cookies, storage and the database,
// which would leak into other test files; the fixture runs it in its own process.
test('an export of a project artifact, a project-level document write, needs a manager; a field worker exports the assigned job artifact only', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/work-artifact-export-access.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
