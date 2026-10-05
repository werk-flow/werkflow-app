import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The link actions need module mocks for identity, cookies and the database,
// which would leak into other test files; the fixture runs them in its own process.
test('a document link change refuses a foreign document, a foreign target and a field worker before its one database write', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/document-link-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
