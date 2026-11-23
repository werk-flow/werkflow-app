import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// SaxonJS decides at load whether it runs in a browser (`typeof window`), and
// earlier files of the one-process unit run leave and remove a `window`
// global. The cases run in their own process so the rule check sees Node.
test('a finalized Stripe invoice becomes one checked original, or nothing and a stable code', async () => {
  const child = Bun.spawn(
    [process.execPath, 'test', './lib/testing/fixtures/werkflow-invoice-issue-cases.ts'],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
