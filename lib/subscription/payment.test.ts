import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The helpers and the action need module mocks for identity, navigation and
// the database, which would leak into other test files; the fixture runs them
// in its own process.
test('only an active subscription counts, and the simulated payment activates the signed-in caller without an organization', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/subscription-payment.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
