import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Security Tier 2 for the shared job-access reads: a permission fact is shared
// within one request only, and a failed read is never a refusal.
test('job access reads share one read per request and read fresh in every other', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/job-access-reads.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
