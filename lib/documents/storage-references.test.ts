import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database and storage modules, which would leak into
// other test files; it runs in its own process.
test('a refused attempt keeps a copy that a version upload archives while the reference read runs', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/storage-reference-reads.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
