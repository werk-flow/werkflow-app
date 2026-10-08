import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture needs module mocks for identity, cookies, storage and the database,
// which would leak into other test files; it runs in its own process.
test('a failed pre-check read in the work-evidence and correction actions is load_failed; a missing row keeps its own code', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/work-evidence-read-failures.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
