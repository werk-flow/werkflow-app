// Rule test: a session that must keep outdated state is frozen through one helper.
import { expect, test } from 'bun:test';
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A multi-session spec whose premise is that one session still shows what
// another session has just changed (a stale draft, a stale approval card)
// passes or fails by timing when a live update reaches that session first:
// P1-17 failed that way. `freezeLiveUpdates` in tests/golden/support/live.ts
// is the one way to hold such a session; ESLint refuses the raw tools in a
// spec (testing.md, "Spec checklist"). Whether a spec has such a premise at
// all is the reviewer's reading.

const ROOT = join(import.meta.dir, '../../..');

test('ESLint refuses taking a session offline or routing its socket inside a spec', async () => {
  const eslint = new ESLint();
  const messages = async (source: string): Promise<string[]> => {
    const [result] = await eslint.lintText(source, { filePath: 'tests/golden/probe.spec.ts' });
    return (result?.messages ?? []).map(({ ruleId, message }) => `${ruleId}: ${message.slice(0, 38)}`);
  };
  const expected = ['no-restricted-syntax: A session that must keep outdated stat'];
  expect(
    await messages('export async function probe(page) {\n  await page.context().setOffline(true);\n}\n'),
  ).toEqual(expected);
  expect(
    await messages(
      'export async function probe(page) {\n  await page.routeWebSocket(/realtime/, () => {});\n}\n',
    ),
  ).toEqual(expected);
});

test('the freeze helper swallows the socket and the catch-up triggers, and offers a release', () => {
  const live = readFileSync(join(ROOT, 'tests/golden/support/live.ts'), 'utf8');
  const helper = live.slice(live.indexOf('export async function freezeLiveUpdates'));
  expect(helper).toContain('routeWebSocket');
  expect(helper).toContain("'visibilitychange'");
  expect(helper).toContain("'focus'");
  expect(helper).toContain('unrouteAll');
});
