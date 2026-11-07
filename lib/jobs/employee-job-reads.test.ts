import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The readers need module mocks for identity, cookies and the database, which
// would leak into other test files; the fixture runs them in its own process.
test("an employee reads other people's jobs by number and title only, open ones or their own time's, and active work only on their own jobs", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/employee-job-read-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
