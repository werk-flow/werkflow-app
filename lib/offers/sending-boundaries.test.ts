import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The handlers need module mocks for identity, cookies, storage and the
// database, which would leak into other test files; the fixture runs them in
// its own process.
test('only Admin and Büro preview and send an offer of their own organization; the stored PDF says what the preview said; field workers get no offer PDF', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/offer-sending-boundaries.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
