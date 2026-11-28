import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

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

test("time-correction actions refuse a lower role and a foreign organization's ids", async () => {
  await runFixture('time-correction-action-boundaries');
});

test("the correction request list and „Vorgemerkte Zeit“ show no request of a person's removed employee record", async () => {
  await runFixture('correction-list-removed-record');
});
