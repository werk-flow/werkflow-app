import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The replays need module mocks for identity, the database, storage and `after()`, which would
// leak into other test files; the fixture runs in its own process.
test('a Lieferschein reaches the model only as capped fields of a tool-less extraction, within its caps, and a stop aborts it', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../../testing/fixtures/ai-lieferschein.ts')],
    {
      cwd: resolve(import.meta.dir, '../../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});
