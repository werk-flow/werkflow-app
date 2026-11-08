import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Each fixture sets synthetic storage configuration and replaces the S3
// client's transport and the database, which would leak into other test
// files; each runs in its own process.
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

test('a second finalize of one upload never changes the registered file and leaves no object behind', async () => {
  await runFixture('document-upload-finalize-race');
});

test('a version finalize refused because the document was filed deletes only its own staging object', async () => {
  await runFixture('document-version-filed-staging');
});

test("a version retry after a lost answer counts only its own upload's saved version as saved", async () => {
  await runFixture('document-version-retry-identity');
});
