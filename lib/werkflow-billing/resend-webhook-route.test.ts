import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database; its own process keeps that mock out of other test files.
test('a Resend signal is refused before any record unless signed, and a bounce raises its alarm once', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/resend-webhook-route.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
