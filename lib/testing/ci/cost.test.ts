// The cost summary counts every job process a run started, a cancelled one and a rerun included,
// names the jobs a plan held that never started, and splits each run across the merged PRs it served.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { jobCost, measurementInputs, pullRequestsOf, summarizeCost } from './cost';
import type { CiJob } from './dag';
import { type CiResult, resultFileName } from './results';

const repository = resolve(import.meta.dir, '../../..');
const T0 = Date.parse('2026-11-21T08:00:00.000Z');
const at = (minute: number): string => new Date(T0 + minute * 60_000).toISOString();
const MINUTE = 60_000;
const tree = (letter: string): string => letter.repeat(40);
const run = (number: number): string => `https://ci.example/runs/${number}`;

type Spec = {
  job: CiJob;
  shard?: number;
  /** Minutes after T0; `to` null leaves the job running: cancelled. */
  from: number;
  to: number | null;
  status?: CiResult['status'];
  setup?: number;
  /** Only the final receipt: Check writes none at its start, and a results folder holds one per job. */
  endOnly?: boolean;
  extra?: Partial<CiResult>;
};

/** The ledger receipts of one job process: its start, and its end unless it never ended. */
function processReceipts(base: RunBase, spec: Spec, legacy = false): CiResult[] {
  const start: CiResult = {
    version: 1,
    job: spec.job,
    shard: spec.shard ?? null,
    commit: 'c'.repeat(40),
    base: null,
    status: 'running',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    startedAt: at(spec.from),
    completedAt: null,
    ...(legacy
      ? {}
      : {
          attempt: 1,
          firstAttemptClass: null,
          cost: { machineStart: true, runnerStartedAt: null, setupMs: 0, wallMs: null },
        }),
    ...base,
    ...spec.extra,
  };
  if (spec.to === null) return [start];
  const end: CiResult = {
    ...start,
    status: spec.status ?? 'passed',
    completedAt: at(spec.to),
    ...(legacy
      ? {}
      : {
          cost: {
            machineStart: true,
            runnerStartedAt: null,
            setupMs: (spec.setup ?? 0) * MINUTE,
            wallMs: (spec.to - spec.from) * MINUTE,
          },
        }),
  };
  return spec.endOnly ? [end] : [start, end];
}

type RunBase = Pick<CiResult, 'runUrl' | 'event' | 'tree' | 'prs'>;
const receiptsOf = (base: RunBase, specs: Spec[], legacy = false): CiResult[] =>
  specs.flatMap((spec) => processReceipts(base, spec, legacy));

const OUTPUTS = { component_shards: JSON.stringify([{ shard: 1, groups: 'ui:contracts:work' }]) };
const planned = (jobs: CiJob[], extra: Partial<NonNullable<CiResult['plan']>> = {}): Partial<CiResult> => ({
  plan: { jobs, skips: {}, shards: [], outputs: OUTPUTS, ...extra },
});

/**
 * PR 12: two PR runs (a Fast rerun after an environment failure; a cancelled component shard and an
 * SQL job that never started), an integration run that reused SQL, and the push that reused its
 * tree. PRs 14 and 15: one batch's integration run and the push that ran again on its tree. PR 13:
 * a run, never merged. Then a full run with a selection miss, a push in receipts written before
 * measurement, and a workstation's receipt without a run.
 */
function fixtureLedger(): CiResult[] {
  const work: CiJob[] = ['plan', 'fast', 'sql', 'components', 'check'];
  return [
    ...receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
      { job: 'plan', from: 0, to: 1, extra: planned(work) },
      { job: 'fast', from: 1, to: 11, setup: 2, status: 'failed' },
      { job: 'sql', from: 1, to: 6, setup: 1 },
      { job: 'components', shard: 1, from: 1, to: 4, setup: 1 },
      { job: 'check', from: 11, to: 12, status: 'failed', endOnly: true },
      {
        job: 'fast',
        from: 12,
        to: 22,
        setup: 2,
        extra: { attempt: 2, firstAttemptClass: 'environment' },
      },
      { job: 'check', from: 22, to: 23, endOnly: true, extra: { attempt: 2 } },
    ]),
    ...receiptsOf({ runUrl: run(2), event: 'pr', tree: tree('b'), prs: [12] }, [
      { job: 'plan', from: 30, to: 31, extra: planned(work) },
      { job: 'fast', from: 31, to: 41, setup: 2 },
      { job: 'components', shard: 1, from: 31, to: null },
      { job: 'check', from: 45, to: 46, status: 'failed', endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(3), event: 'integration', tree: tree('c'), prs: [12] }, [
      {
        job: 'plan',
        from: 60,
        to: 61,
        extra: planned(['plan', 'fast', 'components', 'browser', 'check'], {
          shards: [{ shard: 1, groups: 'golden:p1-01' }],
          reused: [{ job: 'sql', shard: null, runUrl: run(1) }],
        }),
      },
      { job: 'fast', from: 61, to: 71, setup: 2 },
      { job: 'components', shard: 1, from: 61, to: 64, setup: 1 },
      { job: 'browser', shard: 1, from: 71, to: 91, setup: 5 },
      { job: 'check', from: 91, to: 92, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(4), event: 'main', tree: tree('c'), prs: [] }, [
      { job: 'plan', from: 100, to: 101, extra: { ...planned(['plan', 'check']), reusedFrom: run(3) } },
      { job: 'check', from: 101, to: 102, endOnly: true, extra: { reusedFrom: run(3) } },
    ]),
    ...receiptsOf({ runUrl: run(5), event: 'integration', tree: tree('e'), prs: [14, 15] }, [
      { job: 'plan', from: 120, to: 121, extra: planned(['plan', 'fast', 'check']) },
      { job: 'fast', from: 121, to: 131, setup: 2 },
      { job: 'check', from: 131, to: 132, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(6), event: 'main', tree: tree('e'), prs: [] }, [
      { job: 'plan', from: 140, to: 141, extra: planned(['plan', 'fast', 'check']) },
      { job: 'fast', from: 141, to: 147 },
      { job: 'check', from: 147, to: 148, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(7), event: 'pr', tree: tree('7'), prs: [13] }, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'check']) },
      { job: 'check', from: 1, to: 2, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(8), event: 'full', tree: tree('8'), prs: [] }, [
      {
        job: 'plan',
        from: 200,
        to: 201,
        extra: planned(['plan', 'browser', 'check'], { shards: [{ shard: 1, groups: 'golden:p2-03' }] }),
      },
      { job: 'browser', shard: 1, from: 201, to: 261, status: 'failed' },
      {
        job: 'check',
        from: 261,
        to: 262,
        status: 'failed',
        endOnly: true,
        extra: { unselectedFailures: ['golden:p2-03'] },
      },
    ]),
    ...legacyPush(),
    ...processReceipts(
      { runUrl: null, event: 'pr', tree: tree('9'), prs: [] },
      { job: 'fast', from: 0, to: 5, endOnly: true },
    ),
  ];
}

/** A push whose receipts predate measurement: no cost, PRs or attempt. */
function legacyPush(): CiResult[] {
  return receiptsOf(
    { runUrl: run(9), event: 'main', tree: tree('f') },
    [
      { job: 'plan', from: 300, to: 302, extra: planned(['plan', 'check']) },
      { job: 'check', from: 302, to: 303, endOnly: true },
    ],
    true,
  );
}

test('the summary sums each merged PR, a cancelled job, a never-started job and a rerun included', () => {
  const summary = summarizeCost(fixtureLedger());
  const byPr = new Map(summary.merged.map((entry) => [entry.pr, entry]));
  expect([...byPr.keys()].sort()).toEqual([12, 14, 15]);
  // Run 1: 1 + 10 + 5 + 3 + 1 + 10 (rerun) + 1 = 31; run 2: 1 + 10 + 15 (cancelled, to minute 46) + 1
  // = 27; run 3: 1 + 10 + 3 + 20 + 1 = 35; run 4: 2. Run 1's Plan, Fast, SQL, component shard,
  // Check and the rerun's Fast and Check are seven machine starts.
  expect(byPr.get(12)).toEqual({
    pr: 12,
    runs: 4,
    jobMs: 95 * MINUTE,
    machineStarts: 7 + 4 + 5 + 2,
    setupMs: (6 + 2 + 8) * MINUTE,
    // Run 3 reused SQL; the push reused run 3's three executed jobs. Run 1's Fast ran twice.
    reuseHits: 1 + 3,
    executed: 4 + 2 + 3,
    readyToMergeMs: 40 * MINUTE,
  });
  // The batch's run (12 min) and its push (8 min) split across both PRs.
  for (const pr of [14, 15])
    expect(byPr.get(pr)).toEqual({
      pr,
      runs: 2,
      jobMs: 10 * MINUTE,
      machineStarts: 3,
      setupMs: 1 * MINUTE,
      reuseHits: 0,
      executed: 1,
      readyToMergeMs: 20 * MINUTE,
    });
  expect(summary.unmerged).toMatchObject({ runs: 1, jobMs: 2 * MINUTE, machineStarts: 2 });
  expect(summary.full).toMatchObject({ runs: 1, jobMs: 62 * MINUTE, machineStarts: 3, executed: 1 });
  // The legacy push counts its receipts' times and one machine start per process.
  expect(summary.other).toEqual({
    runs: 1,
    jobMs: 3 * MINUTE,
    machineStarts: 2,
    setupMs: 0,
    reuseHits: 0,
    executed: 0,
  });
  expect(summary.all).toMatchObject({ runs: 9, jobMs: 182 * MINUTE, machineStarts: 31 });
  expect(summary.cancelled).toBe(1);
  expect(summary.neverStarted).toBe(1);
  // A failed Check follows a failed job, so only the job's first attempt counts.
  expect(summary.firstAttemptFailures).toEqual({ environment: 1, unclassified: 1 });
  expect(summary.unselectedFailures).toEqual(['golden:p2-03']);
  expect(summary.withoutRun).toBe(1);
});

test('a cancelled attempt ends with its own attempt, a rerun is a process of its own, and a receipt read twice counts once', () => {
  const base = { runUrl: run(1), event: 'pr' as const, tree: tree('a'), prs: [12] };
  const receipts = receiptsOf(base, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
    { job: 'fast', from: 1, to: null },
    { job: 'check', from: 4, to: 5, status: 'failed', endOnly: true },
    { job: 'fast', from: 10, to: 60, endOnly: true, extra: { attempt: 2 } },
    { job: 'check', from: 60, to: 62, endOnly: true, extra: { attempt: 2 } },
  ]);
  const summary = summarizeCost(receipts);
  // Plan 1, the cancelled Fast to minute 5 (not 62), Check 1, the rerun's Fast 50 and Check 2.
  expect(summary.all).toMatchObject({ jobMs: 58 * MINUTE, machineStarts: 5, executed: 2 });
  expect(summary.cancelled).toBe(1);
  // The same receipts from a ledger and a results folder are the same processes.
  expect(summarizeCost([...receipts, ...receipts.filter((receipt) => receipt.status !== 'running')])).toEqual(
    summary,
  );
});

test('a push lands only an integration pass that came before it', () => {
  const receipts = [
    ...receiptsOf({ runUrl: run(3), event: 'integration', tree: tree('c'), prs: [12] }, [
      { job: 'plan', from: 30, to: 31, extra: planned(['plan', 'check']) },
      { job: 'check', from: 49, to: 50, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(4), event: 'main', tree: tree('c'), prs: [] }, [
      { job: 'plan', from: 40, to: 41, extra: planned(['plan', 'check']) },
      { job: 'check', from: 41, to: 42, endOnly: true },
    ]),
  ];
  const summary = summarizeCost(receipts);
  expect(summary.merged).toEqual([]);
  expect(summary.other.runs).toBe(1);
});

test('a push that reused a tree the input lacks counts one reuse hit, and lands no PR', () => {
  const push = fixtureLedger().filter((receipt) => receipt.runUrl === run(4));
  const summary = summarizeCost(push);
  expect(summary.merged).toEqual([]);
  expect(summary.other).toMatchObject({ runs: 1, reuseHits: 1, executed: 0 });
});

test('a job cost adds the runner setup before the body and a shard server start, and no gate step', () => {
  const result = processReceipts(
    { runUrl: run(1), event: 'integration', tree: tree('c'), prs: [12] },
    { job: 'browser', shard: 1, from: 10, to: 30 },
  )[1];
  if (!result) throw new Error('The fixture holds no end receipt.');
  const groups: CiResult['groups'] = [
    { id: 'step:server', outcome: 'passed', durationMs: 4 * MINUTE },
    { id: 'golden:p1-01', outcome: 'passed', durationMs: 12 * MINUTE },
  ];
  expect(
    jobCost({ ...result, groups }, { machineStart: true, runnerStartedAt: at(7), completedAt: at(30) }),
  ).toEqual({ machineStart: true, runnerStartedAt: at(7), setupMs: 7 * MINUTE, wallMs: 23 * MINUTE });
  expect(
    jobCost({ ...result, groups }, { machineStart: false, runnerStartedAt: null, completedAt: null }),
  ).toEqual({ machineStart: false, runnerStartedAt: null, setupMs: 4 * MINUTE, wallMs: null });
  // A runner clock ahead of the body's start counts from the body's start.
  expect(
    jobCost({ ...result, groups: [] }, { machineStart: true, runnerStartedAt: at(12), completedAt: at(30) }),
  ).toEqual({ machineStart: true, runnerStartedAt: at(12), setupMs: 0, wallMs: 20 * MINUTE });
});

test('a pull request list is numbers or a merge-queue ref; anything else is unreadable', () => {
  expect(pullRequestsOf(undefined)).toEqual([]);
  expect(pullRequestsOf('12')).toEqual([12]);
  expect(pullRequestsOf('14,15,14')).toEqual([14, 15]);
  expect(pullRequestsOf(`refs/heads/gh-readonly-queue/main/pr-568-${'a'.repeat(40)}`)).toEqual([568]);
  for (const value of [
    '0',
    '12,',
    'pr-12',
    '#12',
    '9007199254740992',
    `refs/heads/gh-readonly-queue/main/pr-0-${'a'.repeat(40)}`,
  ])
    expect([value, 'unreadable' in pullRequestsOf(value)]).toEqual([value, true]);
});

test('an unreadable measurement input warns and records unknown, so it never fails a job', () => {
  const { warnings, ...unknown } = measurementInputs({
    CI_PRS: 'twelve',
    CI_RUN_ATTEMPT: '9007199254740992',
    CI_FIRST_ATTEMPT_CLASS: 'transient',
    CI_JOB_STARTED_AT: 'soon',
  });
  expect(unknown).toEqual({ prs: [], attempt: 1, firstAttemptClass: null, runnerStartedAt: null });
  expect(warnings.map((warning) => warning.split(' ')[0])).toEqual([
    'CI_PRS',
    'CI_RUN_ATTEMPT',
    'CI_FIRST_ATTEMPT_CLASS',
    'CI_JOB_STARTED_AT',
  ]);
  expect(
    measurementInputs({
      CI_PRS: '12',
      CI_RUN_ATTEMPT: '2',
      CI_FIRST_ATTEMPT_CLASS: 'environment',
      CI_JOB_STARTED_AT: at(0),
    }),
  ).toEqual({
    prs: [12],
    attempt: 2,
    firstAttemptClass: 'environment',
    runnerStartedAt: at(0),
    warnings: [],
  });
});

test('the script reads a ledger file and a results folder, and refuses an unreadable input', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-cost-'));
  try {
    const ledger = join(folder, 'ledger.jsonl');
    const receipts = fixtureLedger();
    writeFileSync(ledger, receipts.map((receipt) => `${JSON.stringify(receipt)}\n`).join(''));
    // A results folder holds each job's newest receipt: run 2's, with its cancelled shard.
    const runFolder = join(folder, 'results', 'run-2');
    mkdirSync(runFolder, { recursive: true });
    for (const receipt of receipts.filter((entry) => entry.runUrl === run(2)))
      writeFileSync(join(runFolder, resultFileName(receipt.job, receipt.shard)), JSON.stringify(receipt));
    const cost = (...paths: string[]): { status: number | null; stdout: string; stderr: string } =>
      spawnSync(process.execPath, ['scripts/ci/cost.ts', ...paths], { cwd: repository, encoding: 'utf8' });

    const fromLedger = cost('--json', ledger);
    expect([fromLedger.status, fromLedger.stderr]).toEqual([0, '']);
    expect(JSON.parse(fromLedger.stdout)).toEqual(JSON.parse(JSON.stringify(summarizeCost(receipts))));

    const fromFolder = cost('--json', join(folder, 'results'));
    expect(fromFolder.status).toBe(0);
    expect(JSON.parse(fromFolder.stdout)).toMatchObject({ cancelled: 1, neverStarted: 1, all: { runs: 1 } });

    const table = cost(ledger);
    expect(table.stdout).toContain('CI cost per merged pull request: 3 merged, 9 runs.');
    expect(table.stdout).toMatch(/^#12 +4 +95\.0 +18\.0 +17 % +31 % +40\.0 min$/m);

    writeFileSync(join(runFolder, 'broken.json'), '{');
    expect(cost(join(folder, 'results')).status).not.toBe(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
