// A draft pull request runs no browser shard, and its required `Check` never passes while the
// plan holds browser groups for the run that marking it ready starts (.github/workflows/ci.yml).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const workflow: unknown = Bun.YAML.parse(
  await Bun.file(resolve(import.meta.dir, '../../.github/workflows/ci.yml')).text(),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `path` in the parsed workflow, or undefined when a step of it is missing. */
function at(...path: (string | number)[]): unknown {
  let value = workflow;
  for (const key of path)
    value =
      Array.isArray(value) && typeof key === 'number'
        ? value[key]
        : isRecord(value)
          ? value[String(key)]
          : undefined;
  return value;
}

const textAt = (...path: (string | number)[]): string => {
  const value = at(...path);
  if (typeof value !== 'string') throw new Error(`ci.yml has no text at ${path.join('.')}`);
  return value;
};

const DRAFT_GUARD = 'github.event.pull_request.draft != true';
const SUCCESS = { result: 'success', outputs: {} };

/** Runs Check's script as GitHub would, with `toJSON(needs)` and the event's draft flag. */
function check(input: { draft: boolean; planBrowser: 'true' | 'false'; browser: string }) {
  const results = {
    plan: { result: 'success', outputs: { browser: input.planBrowser, midnight_until: '' } },
    lint: SUCCESS,
    static: SUCCESS,
    unit: SUCCESS,
    components: SUCCESS,
    sql: SUCCESS,
    build: SUCCESS,
    midnight: { result: 'skipped', outputs: {} },
    browser: { result: input.browser, outputs: {} },
  };
  const run = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', textAt('jobs', 'check', 'steps', 0, 'run')],
    {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        RESULTS: JSON.stringify(results),
        DRAFT: String(input.draft),
      },
    },
  );
  return { passed: run.status === 0, output: run.stdout + run.stderr };
}

test('a draft runs no browser shard and no midnight wait, and marking it ready starts a run', () => {
  expect(at('on', 'pull_request', 'types')).toEqual([
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
  ]);
  expect(textAt('jobs', 'browser', 'if')).toContain(DRAFT_GUARD);
  expect(textAt('jobs', 'midnight', 'if')).toContain(DRAFT_GUARD);
  expect(textAt('jobs', 'check', 'steps', 0, 'env', 'DRAFT')).toContain(
    'github.event.pull_request.draft == true',
  );
});

test("a draft's Check fails while the plan holds browser groups, and says how to run them", () => {
  const held = check({ draft: true, planBrowser: 'true', browser: 'skipped' });
  expect(held.passed).toBe(false);
  expect(held.output).toContain('Draft: browser groups not run. Mark the PR ready (gh pr ready) to run them');
});

test('a draft whose plan selects no browser group holds nothing back, so its Check passes', () => {
  expect(check({ draft: true, planBrowser: 'false', browser: 'skipped' }).passed).toBe(true);
});

test("a ready PR's Check passes only with its browser shards", () => {
  expect(check({ draft: false, planBrowser: 'true', browser: 'success' }).passed).toBe(true);
  const skipped = check({ draft: false, planBrowser: 'true', browser: 'skipped' });
  expect(skipped.passed).toBe(false);
  expect(skipped.output).not.toContain('Draft:');
  expect(check({ draft: false, planBrowser: 'true', browser: 'failure' }).passed).toBe(false);
});
