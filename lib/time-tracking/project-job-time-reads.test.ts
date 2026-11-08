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

test('the project time card reads the approved corrections once per request, not once per job', async () => {
  await runFixture('project-job-time-reads');
});

test("the project time card reads each person's days once per request, not once per job", async () => {
  await runFixture('project-job-day-reads');
});

test('a project read whose merged days exceed the row bound returns what each job read returns', async () => {
  await runFixture('project-job-day-read-bound');
});

test("a job read keeps its session's clock-out that names no job", async () => {
  await runFixture('job-read-paired-clock-out');
});
