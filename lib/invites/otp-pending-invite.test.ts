import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('a pending invite code that is not a valid code ends on the invite error page, never in the app', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/otp-pending-invite.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
