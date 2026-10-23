import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createUnitRunWatchdog, runWatchedUnitTests } from './unit-run-watchdog';

// The runner's wall-clock bound must hold where Bun's own timeout cannot: a
// test that blocks its event loop. These probes drive the watchdog on a fake
// clock, then drive a real `bun test` of a planted blocking test.

const root = resolve('/repository');
const deadlines = { runMs: 10_000, progressMs: 3_000 };

describe('unit run watchdog', () => {
  test('a run within both deadlines goes on; a path split across chunks counts once it is whole', () => {
    const watchdog = createUnitRunWatchdog(deadlines, 0, root);
    watchdog.observe(`${join(root, 'lib', 'a.test.ts')}\n${join(root, 'lib', 'b.te')}`, 2_000);
    expect(watchdog.overdue(4_900)).toBeNull();
    watchdog.observe('st.ts\n', 4_900);
    expect(watchdog.overdue(7_900)).toBeNull();
    expect(watchdog.overdue(7_901)).toBe(
      'no test started for 3 s; the run hangs in lib/b.test.ts or the test file loaded after it.',
    );
  });

  test('a run without any progress is stopped and says no test started', () => {
    const watchdog = createUnitRunWatchdog(deadlines, 0, root);
    expect(watchdog.overdue(3_000)).toBeNull();
    expect(watchdog.overdue(3_001)).toBe(
      'no test started for 3 s; the run hangs before any test started (a test file failed to load or blocked at import).',
    );
  });

  test('a run past its deadline is stopped even while tests keep starting', () => {
    const watchdog = createUnitRunWatchdog(deadlines, 0, root);
    for (let now = 1_000; now <= 10_000; now += 1_000)
      watchdog.observe(`${join(root, 'lib', 'c.test.ts')}\n`, now);
    expect(watchdog.overdue(10_000)).toBeNull();
    expect(watchdog.overdue(10_001)).toBe(
      'the unit run passed its 10 s deadline; it stopped in lib/c.test.ts or the test file loaded after it.',
    );
  });
});

// Bun's own timeout cannot fire while the planted loop holds the event loop, so
// without the kill this probe outlives its own 60 s bound and fails.
test('a test that blocks its event loop is stopped by the watchdog, which names its file', async () => {
  const repositoryRoot = resolve(import.meta.dir, '../../..');
  const folder = mkdtempSync(join(tmpdir(), 'unit-watchdog-'));
  try {
    const blocking = join(folder, 'blocking.test.ts');
    writeFileSync(
      blocking,
      "import { test } from 'bun:test';\ntest('blocks', () => { const end = Date.now() + 90_000; while (Date.now() < end) {} });\n",
    );
    const result = await runWatchedUnitTests(
      [blocking],
      { runMs: 30_000, progressMs: 2_000 },
      repositoryRoot,
    );
    expect(result.exitCode, result.stopped ?? 'not stopped').toBe(1);
    expect(result.stopped).toMatch(/^no test started for 2 s; the run hangs in .*blocking\.test\.ts /);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
