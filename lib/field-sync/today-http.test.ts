import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("the today snapshot holds only the caller's own assigned visits of the Berlin day without office-only fields, refuses a foreign organization's id, a revoked membership and a missing identity, and answers a bearer token and a cookie alike", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/field-sync-today-http.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
