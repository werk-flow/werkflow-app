import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The fixture mocks identity, navigation and the database; its own process keeps them out of other test files.
test('a member names a paid further organization through onboarding, and one without a paid reservation goes to the dashboard', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/onboarding-further-organization.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
