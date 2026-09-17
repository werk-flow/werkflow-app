import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('an unowned mail recipient is refused without skipping the rest of world cleanup', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'fixtures/world-mail-cleanup.ts')], {
    cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
