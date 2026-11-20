// Same-tree reuse stands only on a complete passed CI receipt of the identical key, and the newest
// receipt for the key decides (lib/testing/ci/reuse.ts).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CiResult, readLedger } from './results';
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
  expect(passedTreeInLedger([check({ runUrl: null })], TREE)).toBeUndefined();
  // A later attempt that stopped before its Check, failed or still running, withdraws the pass.
  const later = { event: 'integration', runUrl: 'https://ci.example/runs/2' } as const;
  expect(passedTreeInLedger([check({}), receipt({ ...later, status: 'failed' })], TREE)).toBeUndefined();
  expect(
    passedTreeInLedger([check({}), receipt({ ...later, status: 'running', completedAt: null })], TREE),
  ).toBeUndefined();
});

test('the Actions adapter takes the newest completed queue run of the tree, and only when it passed (real jq)', () => {
  const run = (id: number, tree: string, conclusion: string) => ({
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    head_commit: { tree_id: tree },
    conclusion,
  });
  const jq = (runs: object[], tree = TREE) =>
    spawnSync('jq', ['-r', passedTreeActionsFilter(tree)], {
      input: JSON.stringify({ workflow_runs: runs }),
      encoding: 'utf8',
    }).stdout.trim();
  expect(jq([run(3, OTHER_TREE, 'failure'), run(2, TREE, 'success'), run(1, TREE, 'success')])).toBe(
    'https://github.com/o/r/actions/runs/2',
  );
  expect(jq([run(2, TREE, 'failure'), run(1, TREE, 'success')])).toBe('');
  expect(jq([run(1, TREE, 'success')], 'd'.repeat(40))).toBe('');
});

test('a newer attempt that recorded its key but never finished withdraws an earlier pass', () => {
  const started = receipt({
    status: 'running',
    completedAt: null,
    groups: GROUPS.map((id) => ({ id, outcome: 'not-run', durationMs: 0 })),
  });
  expect(reusableReceipt([receipt(), started], KEY, 'integration')).toBeUndefined();
});

test('an absent ledger is empty; a ledger that cannot be read, or holds one bad line, counts for nothing', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-ledger-'));
  try {
    expect(readLedger(join(folder, 'absent.jsonl'))).toEqual([]);
    const ledger = join(folder, 'ledger.jsonl');
    writeFileSync(ledger, `${JSON.stringify(receipt())}\n`);
    expect(readLedger(ledger)).toEqual([receipt()]);
    writeFileSync(ledger, `${JSON.stringify(receipt())}\n{"version":1}\n`);
    expect(readLedger(ledger)).toEqual({ unreadable: `${ledger}:2 is no valid receipt` });
    const directory = join(folder, 'directory.jsonl');
    mkdirSync(directory);
    expect(readLedger(directory)).toHaveProperty('unreadable');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
