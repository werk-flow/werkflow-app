import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

test('clock and active-job GET reads preserve actual request authorization and independent validated transport', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/time-tracking-state-http.ts')], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});


test('global clock and active-job providers cannot queue background reads as Server Actions', () => {
  for (const file of ['components/clock-state-provider.tsx', 'hooks/use-active-jobs.ts']) {
    const source = readFileSync(resolve(import.meta.dir, '../..', file), 'utf8');
    expect(source).toContain("from '@/lib/time-tracking/state-client'");
    expect(source).not.toMatch(/import[\s\S]*?from ['"]@\/lib\/time-tracking\/actions['"]/);
  }
});


test('direct canonical and aggregate clock actions deny non-members before protected reads', async () => {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures/clock-state-authorization.ts')], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
