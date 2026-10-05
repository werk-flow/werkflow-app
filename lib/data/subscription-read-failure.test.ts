import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('an unknown subscription status fails with a retry instead of showing the paywall', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/subscription-read-failure.tsx')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30_000); // The fixture loads the app layout and the upgrade page in a spawned Bun process; 5 s is not enough under host load.
