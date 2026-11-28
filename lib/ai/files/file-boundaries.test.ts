import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions, the reader and the turn route need module mocks for identity,
// cookies, storage and the database, which would leak into other test files;
// the fixture runs them in its own process.
test("a KI file is uploaded, opened and attached only as the session's own person, in their own organization and thread", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../../testing/fixtures/ai-file-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
