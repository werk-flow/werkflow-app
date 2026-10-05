import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Each fixture replaces identity, framework and database modules; its own
// process keeps those mocks out of other test files.
async function runFixture(name: string): Promise<void> {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, `../testing/fixtures/${name}.ts`)], {
    cwd: resolve(import.meta.dir, '../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}

test('invite redemption is limited per account and per client address, and a limiter outage redeems nothing', async () => {
  await runFixture('rate-limit-handlers');
});

test('invite mail, email-change codes and the simulated payment stop at their limits and on a limiter outage', async () => {
  await runFixture('rate-limit-actions');
});
