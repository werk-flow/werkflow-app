import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test("a field sync replay is a fresh request: a foreign organization's id, another person's session, a revoked membership and a closed period are refused, a bearer token and a cookie reach the same result, and the online clock call is unchanged", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/field-sync-operations-http.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
