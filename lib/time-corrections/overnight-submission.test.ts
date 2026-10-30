import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('a missed overnight shift is one request whose proposal splits at Berlin midnight', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, '../testing/fixtures/time-correction-overnight-submission.ts'),
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
