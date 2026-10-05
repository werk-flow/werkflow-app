import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database client with module mocks, which would leak
// into other test files; it runs in its own process.
test('a failed subscription or membership read rejects instead of answering "not subscribed"', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/subscription-helpers-read-failure.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
