import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture replaces the database and the network; its own process keeps
// those mocks out of other test files.
test('each billing alarm fires once, a repeated signal mails nothing more, and a refused send is retried once', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/billing-mail-signals.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
