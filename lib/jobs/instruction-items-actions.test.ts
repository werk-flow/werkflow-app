import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The actions need module mocks for identity, cookies and the database, which
// would leak into other test files; each fixture runs them in its own process.
async function runFixture(fileName: string): Promise<void> {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../testing/fixtures', fileName)], {
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

test('Instruction list changes are manager-only, never reach another organization, and are one database call each', async () => {
  await runFixture('instruction-item-action-boundaries.ts');
});

test('An instruction reader names a former member without their current email or avatar path', async () => {
  await runFixture('instruction-item-reader-boundaries.ts');
});
