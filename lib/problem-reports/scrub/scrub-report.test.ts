import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The submit action and the scrub need module mocks for identity, the
// database and `after`, which would leak into other test files; the fixture
// runs them in its own process.
test("a stored report is scrubbed with its own organization's dictionary, fails closed, and never fails the receipt", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../../testing/fixtures/problem-report-scrub-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
