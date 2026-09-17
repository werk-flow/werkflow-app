import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('calendar GET preserves actual auth and range checks, private errors and independent client reads', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/calendar-window-http.ts')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
