import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// The route needs module mocks for identity, cookies, `after()` and the
// database, which would leak into other test files; each fixture runs in its own process.
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

test('a WerkFlow KI turn runs under its step limit, switches, budget, retry rules and per-person limits, and only for its author', async () => {
  await runFixture('ai-turn-route');
});

test('a cost write, final save or settlement past its limit ends the turn and keeps the provisional charge', async () => {
  await runFixture('ai-turn-bounded-writes');
});

test('no chat text of a turn, its answer or a provider failure reaches a log', async () => {
  await runFixture('ai-turn-log-sentinel');
});

test('hidden characters and a role-play reach the model neither as instructions nor as tools', async () => {
  await runFixture('ai-turn-context');
});
