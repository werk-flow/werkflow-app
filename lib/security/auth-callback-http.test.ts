import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the auth callback fails closed on an unavailable Auth, redeems neither an invite nor a reset link in a GET and puts no provider data in a URL', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/auth-callback-http.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
