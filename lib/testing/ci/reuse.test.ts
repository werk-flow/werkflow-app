// Same-tree reuse stands only on a complete passed CI receipt of the identical key, and the newest
// receipt for the key decides (lib/testing/ci/reuse.ts).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import type { CiResult } from './results';
import { passedTreeActionsFilter, passedTreeInLedger, type ReuseKey, reusableReceipt } from './reuse';

const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);
const GROUPS = ['sql:grants', 'sql:history', 'step:types', 'step:seed'];
const KEY: ReuseKey = { job: 'sql', tree: TREE, groups: GROUPS, listGrowthApproved: false };

function receipt(overrides: Partial<CiResult> = {}): CiResult {
  return {
    version: 1,
    job: 'sql',
    shard: null,
    event: 'pr',
    tree: TREE,
    commit: 'c'.repeat(40),
    base: 'HEAD^1',
    status: 'passed',
    groups: GROUPS.map((id) => ({ id, outcome: 'passed', durationMs: 1000 })),
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: 'https://ci.example/runs/1',
    startedAt: '2026-11-20T20:00:00.000Z',
    completedAt: '2026-11-20T20:05:00.000Z',
    ...overrides,
  };
}

test('a complete passed CI receipt of the identical key stands for the job, whatever the group order', () => {
  expect(reusableReceipt([receipt()], KEY, 'integration')).toBe('https://ci.example/runs/1');
  expect(reusableReceipt([receipt()], { ...KEY, groups: [...GROUPS].reverse() }, 'main')).toBe(
    'https://ci.example/runs/1',
  );
});

test('reuse never crosses a different tree, job or group list', () => {
  expect(reusableReceipt([receipt({ tree: OTHER_TREE })], KEY, 'integration')).toBeUndefined();
  expect(reusableReceipt([receipt({ job: 'components' })], KEY, 'integration')).toBeUndefined();
  expect(reusableReceipt([receipt()], { ...KEY, groups: GROUPS.slice(1) }, 'integration')).toBeUndefined();
});

test('a failed or incomplete receipt is never reused', () => {
  expect(reusableReceipt([receipt({ status: 'failed' })], KEY, 'integration')).toBeUndefined();
  expect(
    reusableReceipt([receipt({ status: 'running', completedAt: null })], KEY, 'integration'),
  ).toBeUndefined();
  expect(reusableReceipt([receipt({ completedAt: null })], KEY, 'integration')).toBeUndefined();
  const notRun = receipt({ groups: GROUPS.map((id) => ({ id, outcome: 'not-run', durationMs: 0 })) });
  expect(reusableReceipt([notRun], KEY, 'integration')).toBeUndefined();
});

test("a later failed receipt for the same key withdraws an earlier pass, a full run's included", () => {
  expect(reusableReceipt([receipt(), receipt({ status: 'failed' })], KEY, 'integration')).toBeUndefined();
  expect(
    reusableReceipt([receipt(), receipt({ event: 'full', status: 'failed' })], KEY, 'integration'),
  ).toBeUndefined();
  // A failure on another tree withdraws nothing.
  expect(
    reusableReceipt([receipt(), receipt({ tree: OTHER_TREE, status: 'failed' })], KEY, 'integration'),
  ).toBe('https://ci.example/runs/1');
});

test('a changed list-growth approval refuses the reuse', () => {
  expect(reusableReceipt([receipt()], { ...KEY, listGrowthApproved: true }, 'integration')).toBeUndefined();
});

test('a workstation result, a reused result and a full run never stand for a job', () => {
  expect(reusableReceipt([receipt({ producer: null })], KEY, 'integration')).toBeUndefined();
  expect(
    reusableReceipt([receipt({ reusedFrom: 'https://ci.example/runs/0' })], KEY, 'integration'),
  ).toBeUndefined();
  expect(reusableReceipt([receipt({ event: 'full' })], KEY, 'integration')).toBeUndefined();
  expect(reusableReceipt([receipt()], KEY, 'full')).toBeUndefined();
});

test("a push's tree counts as passed only by the newest integration Check of that tree", () => {
  const check = (overrides: Partial<CiResult>) =>
    receipt({ job: 'check', event: 'integration', groups: [], ...overrides });
  expect(passedTreeInLedger([check({})], TREE)).toBe('https://ci.example/runs/1');
  expect(passedTreeInLedger([check({}), check({ status: 'failed' })], TREE)).toBeUndefined();
  expect(passedTreeInLedger([check({ tree: OTHER_TREE })], TREE)).toBeUndefined();
  expect(passedTreeInLedger([check({ event: 'pr' })], TREE)).toBeUndefined();
  expect(passedTreeInLedger([check({ producer: null })], TREE)).toBeUndefined();
  expect(passedTreeInLedger([check({ completedAt: null })], TREE)).toBeUndefined();
});

test('the Actions adapter names the newest green queue run of the tree, or nothing (real jq)', () => {
  const runs = JSON.stringify({
    workflow_runs: [
      { html_url: 'https://github.com/o/r/actions/runs/3', head_commit: { tree_id: OTHER_TREE } },
      { html_url: 'https://github.com/o/r/actions/runs/2', head_commit: { tree_id: TREE } },
      { html_url: 'https://github.com/o/r/actions/runs/1', head_commit: { tree_id: TREE } },
    ],
  });
  const jq = (tree: string) =>
    spawnSync('jq', ['-r', passedTreeActionsFilter(tree)], { input: runs, encoding: 'utf8' }).stdout.trim();
  expect(jq(TREE)).toBe('https://github.com/o/r/actions/runs/2');
  expect(jq('d'.repeat(40))).toBe('');
});
