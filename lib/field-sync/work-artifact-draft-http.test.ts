import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("a report draft's replay is a fresh request: a foreign organization's job, a job the person is not assigned to and a revoked membership are refused before any write, a resend answers replayed, and a draft is never a submit", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/field-sync-draft-http.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
