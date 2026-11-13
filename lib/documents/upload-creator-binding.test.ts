import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("only the person who created an upload ticket finalizes its staged upload; a coworker or a foreign organization's member registers nothing", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/document-upload-creator-binding.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
