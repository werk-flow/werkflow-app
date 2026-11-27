import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('open due maintenance, overdue or due within 14 days, is a task of Admin and Büro of its own organization, never of a field worker, and an overflow fails', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/maintenance-due-tasks.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
