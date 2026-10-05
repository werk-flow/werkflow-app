import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('readiness excludes authentication and all cleanup paths attempt user deletion', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../fixtures/realtime-probe.ts')], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
