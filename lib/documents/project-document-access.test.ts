import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The reads need module mocks for identity, cookies, storage and the database,
// which would leak into other test files; the fixture runs them in its own process.
test('a field worker reads and signs project documents only through an assignment to a job of that project in the own organization, and writes to them never', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/project-document-access.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
