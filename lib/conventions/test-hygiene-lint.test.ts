// Rule test: the test-hygiene lint rules refuse wall-clock waits, polling loops, per-test timeouts, retries, unpinned clocks, fixed time limits and unquarantined skips, in every file family they own.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';
import { formatQuarantines, quarantinesIn } from '../testing/quarantines';
import { effectiveLintRules } from './effective-lint-rules';
import { repositoryRoot } from './product-sources';

const eslint = createProbeLinter();
const UNIT = 'lib/probe/probe.test.ts';
const SPEC = 'tests/golden/probe.spec.ts';
const CONTRACT = 'tests/ui-contracts/probe.spec.ts';
const SUPPORT = 'tests/golden/support/steps/probe.ts';

function trackedFiles(...paths: string[]): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', ...paths], { cwd: repositoryRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

/** The lines one test-hygiene rule reports for a planted source; a parse error fails the probe. */
async function reported(rule: string, source: string, filePath = UNIT): Promise<number[]> {
  const [result] = await eslint.lintText(source, { filePath });
  const messages = result?.messages ?? [];
  expect(messages.filter((message) => message.fatal).map((message) => message.message)).toEqual([]);
  return messages
    .filter((message) => message.ruleId === `test-hygiene/${rule}`)
    .map((message) => message.line);
}

describe('test-hygiene/no-wall-clock-wait', () => {
  test('refuses a sleep in a unit test, a component contract, a browser spec and a support module', async () => {
    const source = [
      'await new Promise((resolve) => setTimeout(resolve, 10));',
      "await new Promise<string>((resolve) => setTimeout(() => resolve('late'), 25));",
      'await new Promise((resolve) => { globalThis.setTimeout(resolve, 5); });',
      'await Bun.sleep(50);',
      'await page.waitForTimeout(300);',
      "import { setTimeout as sleep } from 'node:timers/promises';",
      "import { sleep as nap, Glob } from 'bun';",
    ].join('\n');
    for (const file of [UNIT, CONTRACT, SPEC, SUPPORT])
      expect(await reported('no-wall-clock-wait', source, file), file).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('a flush, a deadline that only rejects and a scheduled callback pass', async () => {
    const source = [
      'await new Promise((resolve) => setImmediate(resolve));',
      "await new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('late')), 15_000); });",
      'await new Promise((resolve, reject) => setTimeout(reject, 1_000));',
      'setTimeout(() => element.remove(), 400);',
      'await expect.poll(() => rows.count()).toBe(2);',
    ].join('\n');
    expect(await reported('no-wall-clock-wait', source, SPEC)).toEqual([]);
  });
});

describe('test-hygiene/no-polling-loop', () => {
  test('refuses a loop that awaits and sleeps or checks a clock deadline', async () => {
    const source = [
      'while (!(await isReady())) await sleep(50);',
      'const deadline = Date.now() + 5_000;',
      'while (!existsSync(path)) {',
      '  if (Date.now() > deadline) throw new Error("missing");',
      '  await tick();',
      '}',
      'for (let attempt = 0; attempt < 2; attempt += 1) { await page.waitForTimeout(300); await open(); }',
      'do { await refresh(); } while (performance.now() < deadline);',
      'while (true) { await check(); const elapsed = Date.now() - start; if (elapsed > 1_000) break; }',
      'while (true) { await check(); const now = Date.now(); const elapsed = now - start; if (elapsed > 1_000) break; }',
    ].join('\n');
    expect(await reported('no-polling-loop', source, SUPPORT)).toEqual([1, 3, 7, 8, 9, 10]);
  });

  test('a loop over items, and the outer loop of a nested poll, pass', async () => {
    const source = [
      'for (const id of ids) await expect(row(id)).toBeVisible();',
      'for (const id of ids) {',
      '  while (Date.now() < deadline) await check(id);',
      '}',
      'while (Date.now() < deadline) count += 1;',
    ].join('\n');
    expect(await reported('no-polling-loop', source, UNIT)).toEqual([3]);
  });
});

describe('test-hygiene/no-per-test-timeout', () => {
  test('refuses every per-test timeout form of Bun and Playwright', async () => {
    const source = [
      "test('a', () => {}, 120_000);",
      "it('b', async () => {}, LIMIT);",
      "describe('c', () => {}, 5_000);",
      "test.skip('d', () => {}, { timeout: 1 });",
      "test('e', { timeout: 10 }, () => {});",
      "test.each([1])('f %d', () => {}, 30_000);",
      "test.skipIf(ISOLATED)('g', async () => {}, 30_000);",
      'setDefaultTimeout(90_000);',
      'jest.setTimeout(90_000);',
      'test.setTimeout(60_000);',
      'test.slow();',
      'testInfo.setTimeout(5_000);',
      'test.info().setTimeout(5_000);',
      'test.describe.configure({ mode: "serial", timeout: 30_000 });',
    ].join('\n');
    expect(await reported('no-per-test-timeout', source, UNIT)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
    expect(await reported('no-per-test-timeout', source, SPEC)).toHaveLength(14);
  });

  test('plain tests, details, steps and assertion timeouts pass', async () => {
    const source = [
      "test('ok', () => { setTimeout(() => {}, 10); });",
      "test('tagged', { tag: '@P1-16' }, async () => {});",
      "test.each([1, 2])('ok %d', (value) => {});",
      "test.skip(isMobile, 'desktop only');",
      "await test.step('save', async () => {}, { box: true });",
      'await expect(row).toBeVisible({ timeout: 5_000 });',
      'test.describe.configure({ mode: "serial" });',
    ].join('\n');
    expect(await reported('no-per-test-timeout', source, SPEC)).toEqual([]);
  });
});

describe('test-hygiene/no-fixed-time-limit', () => {
  test('refuses a wall-clock duration held below a fixed number, however the test writes it', async () => {
    const source = [
      'const start = performance.now();',
      'await save();',
      'const elapsed = performance.now() - start;',
      'expect(elapsed).toBeLessThan(250);',
      'expect(Date.now() - start, "save").toBeLessThanOrEqual(LIMIT_MS);',
      'expect(elapsed).not.toBeGreaterThan(250);',
      'expect(250).toBeGreaterThan(elapsed);',
      'expect(elapsed < 250).toBe(true);',
      'expect(elapsed >= 250).toBe(false);',
      'expect.soft(Bun.nanoseconds() - begun).toBeLessThan(1e9);',
      'if (elapsed > 250) throw new Error("slow");',
      'const took = await page.evaluate(() => performance.now() - window.started);',
      'expect(took).toBeLessThan(2_000);',
      'const deadline = Date.now() + 250;',
      'const limit = deadline;',
      'expect(Date.now()).toBeLessThan(limit);',
      'expect(started).toBeGreaterThan(Date.now() - 250);',
      'const { tookMs } = await page.evaluate(() => ({ tookMs: performance.now() - window.started, rows: 2 }));',
      'expect(tookMs).toBeLessThan(250);',
      'let bound = Date.now();',
      'bound = 0;',
      'expect(performance.now() - start).toBeLessThan(bound);',
      'expect(performance.now() - start).toBeLessThan(isCI ? 250 : Date.now());',
      'const measuredFrom = performance.now();',
      'expect(performance.now() - measuredFrom).toBeLessThan(isCI ? 250 : Date.now());',
      'const limits = { bound: isCI ? 250 : Date.now() };',
      'expect(performance.now() - measuredFrom).toBeLessThan(limits.bound);',
      'expect(Date.now()).toBeLessThan(start + 250);',
      'expect(Date.now() - 250).toBeLessThan(start);',
    ].join('\n');
    for (const file of [CONTRACT, SPEC, SUPPORT, UNIT])
      expect(await reported('no-fixed-time-limit', source, file), file).toEqual([
        4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 17, 19, 22, 23, 25, 27, 28, 29,
      ]);
  });

  test('an ordering of clock readings, a lower bound, a count and a controlled clock pass', async () => {
    const source = [
      'const before = Date.now();',
      'await save();',
      'const after = Date.now();',
      'const capturedAt = Date.parse(envelope.capturedAt);',
      'expect(capturedAt).toBeGreaterThanOrEqual(before);',
      'expect(capturedAt).toBeLessThanOrEqual(after);',
      'expect(after - before).toBeLessThanOrEqual(Date.now() - before);',
      'expect(after - before).toBeGreaterThanOrEqual(0);',
      'let returnedAt = 0;',
      'await going.then(() => { returnedAt = Date.now(); });',
      'expect(returnedAt).toBeGreaterThanOrEqual(after);',
      'expect(rows.length).toBeLessThan(250);',
      'let counted = { rows: 0 };',
      'counted = { rows: counted.rows + 1 };',
      'expect(counted.rows).toBeLessThan(100);',
      'let tally = { count: 0 };',
      'tally = { count: tally.count + 1 };',
      'expect(tally.count).toBeLessThan(5);',
      'const samples = [Date.now()];',
      'expect(samples.length).toBeLessThan(3);',
      'let ceiling = { at: Date.now() };',
      'ceiling = { at: ceiling.at };',
      'expect(Date.now() - before).toBeLessThan(ceiling.at);',
      "test('clocked', async ({ page }) => {",
      '  await page.clock.install();',
      '  const age = await page.evaluate(() => Date.now() - Number(localStorage.getItem("at")));',
      '  expect(age).toBeLessThan(120_000);',
      '});',
      "test.describe('fake timers', () => {",
      '  test.beforeEach(() => setSystemTime(new Date("2026-03-02T08:00:00Z")));',
      "  test('aged', () => { expect(Date.now() - opened).toBeLessThan(60_000); });",
      '});',
      'const sample = await page.evaluate(() => ({ takenAt: Date.now(), rowCount: rows.length }));',
      'expect(sample.rowCount).toBeLessThan(100);',
      'const { rowCount } = await page.evaluate(() => ({ takenAt: Date.now(), rowCount: rows.length }));',
      'expect(rowCount).toBeLessThan(100);',
      'const nested = { rowCount: rows.length, metadata: { rowCount: Date.now() - start } };',
      'expect(nested.rowCount).toBeLessThan(100);',
      'const { rowCount: count } = nested;',
      'expect(count).toBeLessThan(100);',
      'expect(Date.now()).toBeGreaterThanOrEqual(start + 250);',
      'expect(start).toBeLessThan(Date.now() - 250);',
      // The bound reads the clock after `before`: the elapsed time is only held above -250 ms.
      'expect(before).toBeLessThan(Date.now() + 250);',
      'expect(before - 250).toBeLessThan(Date.now());',
    ].join('\n');
    expect(await reported('no-fixed-time-limit', source, CONTRACT)).toEqual([]);
  });

  test("a controlled clock covers only its own reads: the page's in a page function, Date after setSystemTime", async () => {
    const source = [
      "test('page clock', async ({ page }) => {",
      '  expect(await page.evaluate(() => performance.now() - window.opened)).toBeLessThan(250);',
      '  await page.clock.install();',
      '  const started = performance.now();',
      '  await page.clock.fastForward("11:00");',
      '  expect(performance.now() - started).toBeLessThan(250);',
      '  expect(await page.evaluate(() => Date.now() - window.opened)).toBeLessThan(120_000);',
      '});',
      "test('system time', () => {",
      '  setSystemTime(new Date("2026-03-02T08:00:00Z"));',
      '  const started = performance.now();',
      '  expect(performance.now() - started).toBeLessThan(250);',
      '  expect(Date.now() - opened).toBeLessThan(60_000);',
      '});',
    ].join('\n');
    expect(await reported('no-fixed-time-limit', source, CONTRACT)).toEqual([2, 6, 12]);
  });

  test('a seeded fixed limit fails the lint of a real contract and of a shared session helper', async () => {
    const seed = `
export async function seeded(page) {
  const started = Date.now();
  await page.getByRole('main').click();
  expect(Date.now() - started).toBeLessThan(250);
}
`;
    for (const file of ['tests/ui-contracts/problem-report.spec.ts', 'tests/golden/support/sessions.ts']) {
      const source = `${readFileSync(resolve(repositoryRoot, file), 'utf8')}${seed}`;
      expect(await reported('no-fixed-time-limit', source, file), file).toHaveLength(1);
    }
  });
});

describe('test-hygiene/no-retries', () => {
  test('refuses retries in a config, a describe block and a test option', async () => {
    expect(
      await reported(
        'no-retries',
        'export default { retries: process.env.CI ? 2 : 0 };',
        'playwright.config.ts',
      ),
    ).toEqual([1]);
    expect(
      await reported(
        'no-retries',
        'export default { retries: 0 };',
        'tests/ui-contracts/playwright.config.ts',
      ),
    ).toEqual([]);
    const source = [
      'test.describe.configure({ retries: 2 });',
      "test('a', async () => {}, { retry: 3 });",
      "test('b', async () => {}, { repeats: 20 });",
    ].join('\n');
    expect(await reported('no-retries', source, UNIT)).toEqual([1, 2, 3]);
    expect(await reported('no-retries', source, SPEC)).toEqual([1, 2, 3]);
  });

  test('refuses a repeat flag in a runner, and a test may name one as data', async () => {
    const source = [
      "const args = ['test', '--rerun-each', '3'];",
      "const more = ['--retries=2', `--repeat-each=${count}`, '--retry'];",
      "const fine = ['--timeout', '--workers=1', 'no--retries'];",
      "execFileSync('sh', ['-c', 'bun test --rerun-each 3']);",
    ].join('\n');
    expect(await reported('no-retries', source, 'scripts/run-unit-tests.ts')).toEqual([1, 2, 2, 2, 4]);
    expect(await reported('no-retries', source, 'lib/testing/runner/probe-runner.ts')).toEqual([
      1, 2, 2, 2, 4,
    ]);
    expect(await reported('no-retries', source, UNIT)).toEqual([]);
  });

  test('no package script, workflow or Bun config repeats or retries a test', () => {
    // ESLint reads none of these files, so this check owns them.
    const repeats = trackedFiles('package.json', 'bunfig.toml', '.github').flatMap((file) =>
      readFileSync(resolve(repositoryRoot, file), 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          /--(?:rerun-each|retries|retry|repeat-each)\b|^\s*(?:retry|rerunEach|retries)\s*=/.test(line)
            ? [`${file}:${index + 1}`]
            : [],
        ),
    );
    expect(repeats).toEqual([]);
  });
});

describe('test-hygiene/no-unpinned-clock', () => {
  test('refuses a wall-clock read in a unit test', async () => {
    const source = [
      'const now = Date.now();',
      'const today = new Date();',
      'const label = Date();',
      'const started = performance.now();',
      'const stale = new Date(Date.now() - 60_000);',
    ].join('\n');
    expect(await reported('no-unpinned-clock', source, UNIT)).toEqual([1, 2, 3, 4, 5]);
    expect(await reported('no-unpinned-clock', source, 'lib/probe/probe.test.tsx')).toHaveLength(5);
  });

  test('a fixed instant and a pinned system time pass; a browser spec takes its date from the run', async () => {
    const source = [
      "const NOW = new Date('2026-10-14T10:00:00.000Z');",
      'setSystemTime(NOW);',
      'const later = new Date(NOW.getTime() + 60_000);',
      'const origin = performance.timeOrigin;',
    ].join('\n');
    expect(await reported('no-unpinned-clock', source, UNIT)).toEqual([]);
    expect(await reported('no-unpinned-clock', 'const started = Date.now();', SPEC)).toEqual([]);
  });
});

describe('test-hygiene/no-excluded-test', () => {
  const QUARANTINE = '// quarantine: werk-flow/werkflow-planning#35 the picker races its options';

  test('refuses a committed .only anywhere and a skip without a quarantine', async () => {
    const source = [
      "test.only('a', () => {});",
      "describe.only('b', () => {});",
      "test.describe.only('c', () => {});",
      "test.skip('d', () => {});",
      "it.skip('e', () => {});",
      "test.describe.skip('f', () => {});",
      "test.fixme('g', async () => {});",
      "test.todo('h');",
      "test('i', async () => { test.skip(); });",
      "test('j', async () => { test.info().skip(); });",
    ].join('\n');
    for (const file of [UNIT, SPEC, CONTRACT])
      expect(await reported('no-excluded-test', source, file), file).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('a quarantine with its issue and reason admits the skip on the next line', async () => {
    const source = [QUARANTINE, "test.skip('a', () => {});", "test.skipIf(ISOLATED)('b', () => {});"].join(
      '\n',
    );
    expect(await reported('no-excluded-test', source, UNIT)).toEqual([]);
    expect(await reported('no-excluded-test', source, SPEC)).toEqual([]);
  });

  test('refuses a quarantine without an issue or reason, and one that skips nothing', async () => {
    const source = [
      '// quarantine: the picker races its options',
      "test.skip('a', () => {});",
      '// quarantine: werk-flow/werkflow-planning#35',
      "test.skip('b', () => {});",
      QUARANTINE,
      '',
      "test.skip('c', () => {});",
      QUARANTINE,
      "test('d', () => {});",
    ].join('\n');
    expect(await reported('no-excluded-test', source, UNIT)).toEqual([2, 4, 5, 7, 8]);
  });

  test('refuses any quarantine in security, SQL and action-boundary tests', async () => {
    const source = [QUARANTINE, "test.skip('a', () => {});"].join('\n');
    for (const file of ['tests/audit/security/probe.spec.ts', 'lib/security/probe.test.ts'])
      expect(await reported('no-excluded-test', source, file), file).toEqual([2]);
    const fixtureRunner = [
      "const fixture = 'lib/testing/fixtures/widget-boundaries.ts';",
      QUARANTINE,
      "test.skip('runs the boundary fixture', () => {});",
    ].join('\n');
    expect(await reported('no-excluded-test', fixtureRunner, UNIT)).toEqual([3]);
  });

  test('no SQL test carries a quarantine', () => {
    // ESLint reads no SQL, so this check owns the refusal for supabase/tests/.
    const quarantined = trackedFiles('supabase/tests').filter((file) =>
      /quarantine:/i.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
    expect(quarantined).toEqual([]);
  });
});

describe('quarantine list', () => {
  test('lists each quarantine comment with its issue and reason, never a quoted one, and says when there is none', () => {
    const source = [
      'import { test } from "bun:test";',
      '  // quarantine: werk-flow/werkflow-planning#35 a | b',
      "  test.skip('a', () => {});",
      "const quoted = '// quarantine: werk-flow/werkflow-planning#36 only a string';",
      'const template = `',
      '// quarantine: werk-flow/werkflow-planning#37 only a template`;',
    ].join('\n');
    const listed = quarantinesIn('lib/probe/probe.test.ts', source);
    expect(listed).toEqual([{ file: 'lib/probe/probe.test.ts', line: 2, issue: 35, reason: 'a | b' }]);
    expect(formatQuarantines(listed)).toContain(
      '| `lib/probe/probe.test.ts:2` | werk-flow/werkflow-planning#35 | a \\| b |',
    );
    expect(quarantinesIn('lib/probe/probe.test.ts', '// quarantine: no issue\n')).toEqual([]);
    expect(formatQuarantines([])).toContain('No test is quarantined.');
  });
});

describe('test-hygiene scope', () => {
  test('every test family carries the rules, and only unit tests the clock rule', async () => {
    const shared = [
      'no-wall-clock-wait',
      'no-polling-loop',
      'no-per-test-timeout',
      'no-retries',
      'no-excluded-test',
    ];
    for (const file of [
      UNIT,
      'lib/probe/probe.test.mjs',
      SPEC,
      CONTRACT,
      'tests/audit/wave-1/probe.spec.ts',
      SUPPORT,
      'tests/canary/support/probe.ts',
    ]) {
      const rules = effectiveLintRules(await eslint.calculateConfigForFile(file));
      for (const rule of [...shared, 'no-fixed-time-limit'])
        expect(rules[`test-hygiene/${rule}`]?.[0], `${file} ${rule}`).toBe(2);
      expect(rules['test-hygiene/no-unpinned-clock']?.[0] === 2, file).toBe(file.startsWith('lib/'));
    }
    for (const file of [
      'scripts/run-unit-tests.ts',
      'playwright.audit.config.ts',
      'lib/testing/runner/probe-runner.ts',
    ]) {
      const rules = effectiveLintRules(await eslint.calculateConfigForFile(file));
      expect(rules['test-hygiene/no-retries'], file).toEqual([2, { flags: true }]);
    }
  });
});
