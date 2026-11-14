import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The handler needs module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs it in its own process.
test('only Admin and Büro get the Muster-E-Rechnung XML, checked; an employee and a signed-out caller get none', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/sample-invoice-xml-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
