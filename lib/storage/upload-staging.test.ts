import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture sets synthetic storage configuration and replaces the S3 client's
// transport, which would leak into other test files; it runs in its own process.
test('a signed upload writes a staging key, and finalize registers the server copy of it', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/storage-upload-staging.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
