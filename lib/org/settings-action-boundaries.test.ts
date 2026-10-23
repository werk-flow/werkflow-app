import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('organization settings, calendar, deletion and switch actions refuse everyone but the owner or a member', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, '../testing/fixtures/organization-settings-action-boundaries.ts'),
    ],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
