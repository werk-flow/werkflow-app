// A draft pull request runs no browser shard, and its required `Check` never passes while the
// plan holds browser groups for the run that marking it ready starts (.github/workflows/ci.yml).
import { expect, test } from 'bun:test';
import { readWorkflow } from './ci-workflow';

const ci = readWorkflow('ci.yml');

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
  return ci.runStep('check', 'Require every job to pass', {
    env: { RESULTS: JSON.stringify(results), DRAFT: String(input.draft) },
  });
}

test('a draft runs no browser shard and no midnight wait, and marking it ready starts a run', () => {
  expect(ci.at('on', 'pull_request', 'types')).toEqual([
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
  ]);
  expect(ci.text('jobs', 'browser', 'if')).toContain(DRAFT_GUARD);
  expect(ci.text('jobs', 'midnight', 'if')).toContain(DRAFT_GUARD);
  expect(ci.text('jobs', 'check', 'steps', 0, 'env', 'DRAFT')).toContain(
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
