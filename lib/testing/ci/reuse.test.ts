// The reuse rule, over every ordering that broke it before: the newest start decides, every entry
// after it must belong to its run, and the last of them must be that run's passed result
// (lib/testing/ci/reuse.ts).
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CiEvent } from './dag';
import { type CiResult, readLedger } from './results';
import {
  ledgerAfterStart,
  passedTree,
  passedTreeActionsFilter,
  type ReuseKey,
  reusableReceipt,
} from './reuse';

const TREE = 'a'.repeat(40);
const OTHER_TREE = 'b'.repeat(40);
const GROUPS = ['sql:grants', 'sql:history', 'step:types', 'step:seed'];
const KEY: ReuseKey = { job: 'sql', shard: null, tree: TREE, groups: GROUPS, listGrowthApproved: false };
const RUN_1 = 'https://ci.example/runs/1';
const RUN_2 = 'https://ci.example/runs/2';
/** The merge-queue lookup; a configured ledger never asks it. */
const queueUnasked = (): never => {
  throw new Error('A configured ledger asked the merge queue.');
};

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
    runUrl: RUN_1,
    startedAt: '2026-11-20T20:00:00.000Z',
    completedAt: '2026-11-20T20:05:00.000Z',
    ...overrides,
  };
}

/** A job's start receipt: its planned key, before any group ran. */
const jobStart = (overrides: Partial<CiResult> = {}): CiResult =>
  receipt({
    status: 'running',
    completedAt: null,
    groups: GROUPS.map((id) => ({ id, outcome: 'not-run', durationMs: 0 })),
    ...overrides,
  });
const jobPass = (overrides: Partial<CiResult> = {}): CiResult => receipt(overrides);
const jobFail = (overrides: Partial<CiResult> = {}): CiResult => receipt({ status: 'failed', ...overrides });

type Case = { name: string; ledger: CiResult[] | { unreadable: string }; expected: string | undefined };

const JOB_CASES: Case[] = [
  { name: 'its own start, then its pass', ledger: [jobStart(), jobPass()], expected: RUN_1 },
  {
    name: 'an older failure, then a newer run that passed',
    ledger: [jobStart(), jobFail(), jobStart({ runUrl: RUN_2 }), jobPass({ runUrl: RUN_2 })],
    expected: RUN_2,
  },
  {
    name: 'an older pass, then a newer start',
    ledger: [jobStart(), jobPass(), jobStart({ runUrl: RUN_2 })],
    expected: undefined,
  },
  {
    name: 'a newer start, then the older run’s late pass',
    ledger: [jobStart(), jobStart({ runUrl: RUN_2 }), jobPass()],
    expected: undefined,
  },
  {
    name: 'a newer failure whose start is missing',
    ledger: [jobStart(), jobPass(), jobFail({ runUrl: RUN_2 })],
    expected: undefined,
  },
  {
    name: "a newer full run's failure whose start is missing",
    ledger: [jobStart(), jobPass(), jobFail({ runUrl: RUN_2, event: 'full' })],
    expected: undefined,
  },
  {
    name: 'a newer start in a changed checkout',
    ledger: [
      jobStart(),
      jobPass(),
      jobStart({ runUrl: RUN_2, producer: null }),
      jobPass({ runUrl: RUN_2, producer: null }),
    ],
    expected: undefined,
  },
  { name: 'an unreadable ledger', ledger: { unreadable: 'ledger.jsonl:2 is no JSON' }, expected: undefined },
  {
    name: 'an entry without a run, before the start',
    ledger: [jobFail({ runUrl: null }), jobStart(), jobPass()],
    expected: undefined,
  },
  {
    name: 'an entry without a run, after the pass',
    ledger: [jobStart(), jobPass(), jobFail({ runUrl: null })],
    expected: undefined,
  },
  { name: 'a pass without its start', ledger: [jobPass()], expected: undefined },
  { name: 'a start without its end', ledger: [jobStart()], expected: undefined },
  { name: 'a failed end', ledger: [jobStart(), jobFail()], expected: undefined },
  {
    name: 'an end without completion',
    ledger: [jobStart(), jobPass({ completedAt: null })],
    expected: undefined,
  },
  {
    name: 'a passed end whose groups did not all pass',
    ledger: [
      jobStart(),
      jobPass({ groups: GROUPS.map((id) => ({ id, outcome: 'not-run', durationMs: 0 })) }),
    ],
    expected: undefined,
  },
  {
    name: 'a workstation pass',
    ledger: [jobStart({ producer: null }), jobPass({ producer: null })],
    expected: undefined,
  },
  {
    name: 'a pass that itself reused one',
    ledger: [jobStart(), jobPass({ reusedFrom: 'https://ci.example/runs/0' })],
    expected: undefined,
  },
  {
    name: "a full run's pass",
    ledger: [jobStart({ event: 'full' }), jobPass({ event: 'full' })],
    expected: undefined,
  },
  {
    name: 'a newer run of another tree, job, group list or approval',
    ledger: [
      jobStart(),
      jobPass(),
      jobFail({ runUrl: RUN_2, tree: OTHER_TREE }),
      jobFail({ runUrl: RUN_2, job: 'components' }),
      jobFail({ runUrl: RUN_2, groups: [] }),
      jobFail({ runUrl: RUN_2, listGrowthApproved: true }),
    ],
    expected: RUN_1,
  },
];

for (const { name, ledger, expected } of JOB_CASES)
  test(`per-job reuse, ${name}: ${expected ? 'reuses' : 'runs the job'}`, () => {
    expect(reusableReceipt(ledger, KEY, 'integration')).toBe(expected);
  });

test('per-job reuse ignores the group order, and never serves a full run or another list-growth approval', () => {
  const ledger = [jobStart(), jobPass()];
  expect(reusableReceipt(ledger, { ...KEY, groups: [...GROUPS].reverse() }, 'main')).toBe(RUN_1);
  for (const event of ['pr', 'integration', 'main'] satisfies CiEvent[])
    expect(reusableReceipt(ledger, KEY, event)).toBe(RUN_1);
  expect(reusableReceipt(ledger, KEY, 'full')).toBeUndefined();
  expect(reusableReceipt(ledger, { ...KEY, listGrowthApproved: true }, 'integration')).toBeUndefined();
});

test("a shard's receipt stands only for the same shard number of the same groups", () => {
  const shard2 = { job: 'components', shard: 2 } as const;
  const ledger = [jobStart(shard2), jobPass(shard2)];
  expect(reusableReceipt(ledger, { ...KEY, ...shard2 }, 'integration')).toBe(RUN_1);
  expect(reusableReceipt(ledger, { ...KEY, ...shard2, shard: 1 }, 'integration')).toBeUndefined();
});

/** An integration run's Plan start and its other receipts. */
const planStart = (overrides: Partial<CiResult> = {}): CiResult =>
  receipt({
    job: 'plan',
    event: 'integration',
    groups: [],
    status: 'running',
    completedAt: null,
    ...overrides,
  });
const checkPass = (overrides: Partial<CiResult> = {}): CiResult =>
  receipt({ job: 'check', event: 'integration', groups: [], ...overrides });
const fastFail = (overrides: Partial<CiResult> = {}): CiResult =>
  receipt({ job: 'fast', event: 'integration', status: 'failed', ...overrides });

const TREE_CASES: Case[] = [
  {
    name: 'its own start, then its passed Check',
    ledger: [planStart(), fastFail({ status: 'passed' }), checkPass()],
    expected: RUN_1,
  },
  {
    name: 'an older failed run, then a newer run that passed',
    ledger: [
      planStart(),
      checkPass({ status: 'failed' }),
      planStart({ runUrl: RUN_2 }),
      checkPass({ runUrl: RUN_2 }),
    ],
    expected: RUN_2,
  },
  {
    name: 'an older pass, then a newer start',
    ledger: [planStart(), checkPass(), planStart({ runUrl: RUN_2 })],
    expected: undefined,
  },
  {
    name: 'a newer start, then the older run’s late passed Check',
    ledger: [planStart(), planStart({ runUrl: RUN_2 }), checkPass()],
    expected: undefined,
  },
  {
    name: 'a newer failed Check whose Plan start is missing',
    ledger: [planStart(), checkPass(), checkPass({ runUrl: RUN_2, status: 'failed' })],
    expected: undefined,
  },
  {
    name: 'a newer failed job whose Plan start is missing',
    ledger: [planStart(), checkPass(), fastFail({ runUrl: RUN_2 })],
    expected: undefined,
  },
  {
    name: 'a newer Plan start in a changed checkout',
    ledger: [planStart(), checkPass(), planStart({ runUrl: RUN_2, producer: null })],
    expected: undefined,
  },
  { name: 'an unreadable ledger', ledger: { unreadable: 'ledger.jsonl:2 is no JSON' }, expected: undefined },
  {
    name: 'an entry without a run, before the start',
    ledger: [fastFail({ runUrl: null }), planStart(), checkPass()],
    expected: undefined,
  },
  {
    name: 'an entry without a run, after the Check',
    ledger: [planStart(), checkPass(), fastFail({ runUrl: null })],
    expected: undefined,
  },
  { name: 'a passed Check without its Plan start', ledger: [checkPass()], expected: undefined },
  { name: 'a failed Check', ledger: [planStart(), checkPass({ status: 'failed' })], expected: undefined },
  {
    name: 'a Check without completion',
    ledger: [planStart(), checkPass({ completedAt: null })],
    expected: undefined,
  },
  {
    name: 'a Check without a producer',
    ledger: [planStart(), checkPass({ producer: null })],
    expected: undefined,
  },
  {
    name: 'a Check that reused a tree',
    ledger: [planStart(), checkPass({ reusedFrom: RUN_2 })],
    expected: undefined,
  },
  {
    name: 'a run that ends in a passed job, not its Check',
    ledger: [planStart(), checkPass(), fastFail({ status: 'passed' })],
    expected: undefined,
  },
  {
    name: "a pull request run's passed Check",
    ledger: [planStart({ event: 'pr' }), checkPass({ event: 'pr' })],
    expected: undefined,
  },
  {
    name: 'a newer pull request run of the tree',
    ledger: [
      planStart(),
      checkPass(),
      planStart({ runUrl: RUN_2, event: 'pr' }),
      checkPass({ runUrl: RUN_2, event: 'pr' }),
    ],
    expected: undefined,
  },
  {
    name: 'a newer run of another tree',
    ledger: [
      planStart(),
      checkPass(),
      planStart({ runUrl: RUN_2, tree: OTHER_TREE }),
      fastFail({ runUrl: RUN_2, tree: OTHER_TREE }),
    ],
    expected: RUN_1,
  },
];

for (const { name, ledger, expected } of TREE_CASES)
  test(`a push's passed tree, ${name}: ${expected ? 'reuses the run' : 'runs the work'}`, () => {
    expect(passedTree(ledger, TREE, queueUnasked)).toBe(expected);
  });

test("a configured ledger is a push's only source of a passed tree; the merge queue answers only without one", () => {
  const queue = (): string => 'https://github.com/o/r/actions/runs/9';
  // Another run's newer start withdrew the pass in the ledger: a green queue run cannot restore it.
  expect(passedTree([planStart(), checkPass(), planStart({ runUrl: RUN_2 })], TREE, queue)).toBeUndefined();
  expect(passedTree([], TREE, queue)).toBeUndefined();
  expect(passedTree([planStart(), checkPass()], TREE, queue)).toBe(RUN_1);
  expect(passedTree(undefined, TREE, queue)).toBe('https://github.com/o/r/actions/runs/9');
});

test('the Actions adapter takes the newest queue run of the tree, and only when it completed and passed (real jq)', () => {
  const run = (id: number, tree: string, conclusion: string | null) => ({
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    head_commit: { tree_id: tree },
    status: conclusion === null ? 'in_progress' : 'completed',
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
  expect(jq([run(2, TREE, null), run(1, TREE, 'success')])).toBe('');
  expect(jq([run(1, TREE, 'success')], 'd'.repeat(40))).toBe('');
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
    // A receipt with an empty run URL names no run, so it is invalid and the ledger withholds reuse.
    writeFileSync(
      ledger,
      `${JSON.stringify(planStart())}\n${JSON.stringify(checkPass())}\n${JSON.stringify(fastFail({ runUrl: '' }))}\n`,
    );
    expect(readLedger(ledger)).toEqual({ unreadable: `${ledger}:3 is no valid receipt` });
    expect(passedTree(readLedger(ledger), TREE, queueUnasked)).toBeUndefined();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** Plan's own start in run 2, and a ledger file that holds `before` until Plan appends. */
function planLedger(before: CiResult[], during: CiResult[] = []) {
  const own = planStart({ runUrl: RUN_2, startedAt: '2026-11-20T21:00:00.000Z' });
  const file = [...before];
  let appended = false;
  const ledger = ledgerAfterStart(
    own,
    () => {
      file.push(own, ...during);
      appended = true;
    },
    () => {
      if (!appended) throw new Error('Plan read the ledger before it appended its own start.');
      return file;
    },
  );
  return { own, ledger };
}

test("Plan reads the ledger only after its own start, so another run's start appended meanwhile withdraws the reuse", () => {
  const older = [planStart(), checkPass()];
  // Only Plan's own start follows the pass: the push reuses it.
  expect(passedTree(planLedger(older).ledger, TREE, queueUnasked)).toBe(RUN_1);
  // Another run's same-tree start lands after Plan's own: it withdraws the pass.
  const another = planStart({ runUrl: 'https://ci.example/runs/3' });
  expect(passedTree(planLedger(older, [another]).ledger, TREE, queueUnasked)).toBeUndefined();
  // A rerun of Plan's own run is another start, not Plan's exact receipt: it withdraws the pass too.
  const rerun = planStart({ runUrl: RUN_2, startedAt: '2026-11-20T21:00:01.000Z' });
  expect(passedTree(planLedger(older, [rerun]).ledger, TREE, queueUnasked)).toBeUndefined();
});

test('a ledger Plan cannot append its start to, cannot read, or that lacks its start reuses nothing', () => {
  const older = [planStart(), checkPass()];
  const own = planStart({ runUrl: RUN_2 });
  const rejected = ledgerAfterStart(
    own,
    () => {
      throw new Error('EACCES: permission denied');
    },
    () => older,
  );
  expect(rejected).toEqual({ unreadable: "Plan's start could not be appended: EACCES: permission denied" });
  expect(passedTree(rejected, TREE, queueUnasked)).toBeUndefined();
  const unreadable = ledgerAfterStart(
    own,
    () => {},
    () => ({ unreadable: 'ledger.jsonl:2 is no JSON' }),
  );
  expect(unreadable).toEqual({ unreadable: 'ledger.jsonl:2 is no JSON' });
  const lost = ledgerAfterStart(
    own,
    () => {},
    () => older,
  );
  expect(lost).toEqual({ unreadable: "the ledger lacks Plan's own start" });
  expect(passedTree(lost, TREE, queueUnasked)).toBeUndefined();
});
