import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The handlers need module mocks for storage and the database, which would
// leak into other test files; the fixture runs them in its own process.
test('only the hand-out secret reaches a report thread handler, and a hand-out carries the scrubbed copy and nothing of the originals', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/problem-report-handout-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
