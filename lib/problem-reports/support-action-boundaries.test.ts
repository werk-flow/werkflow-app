import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions need module mocks for identity, storage and the database, which
// would leak into other test files; the fixture runs them in its own process.
test('only an allowlisted support person reaches a support action, and an original leaves only after its opening is in the history', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/problem-report-support-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
