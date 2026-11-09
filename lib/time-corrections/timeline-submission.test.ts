import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("a forgotten day's timeline is one request with its break and job; foreign ids and another person's visits are refused", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, '../testing/fixtures/time-correction-timeline-submission.ts'),
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
