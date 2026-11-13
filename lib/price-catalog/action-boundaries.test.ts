import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('Leistungen and their prices answer only Admin and Büro, inside their own organization', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/leistung-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
