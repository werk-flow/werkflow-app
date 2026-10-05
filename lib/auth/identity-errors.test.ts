import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('the proxy and the identity reader classify every Auth error the same way', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/identity-classification.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30_000); // A spawned Bun process that loads next/server took 4 to 6 s under host load; 5 s is not enough.
