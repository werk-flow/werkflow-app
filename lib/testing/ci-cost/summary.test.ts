// The cost summary counts every job process a run started, a cancelled one and a rerun included,
// names the jobs a plan held that never started, and splits each run across the merged PRs it served.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CiJob } from '../ci/dag';
import { type CiResult, resultFileName } from '../ci/results';
import type { BoatRun } from '../boat/boat-runs';
import { formatCost, summarizeCost } from './summary';

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
    // Run 3 reused SQL; the push reused run 3's three executed jobs and its SQL. Run 1's Fast ran twice.
    reuseHits: 1 + 4,
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
  // Run 1's failed Check follows its failed Fast, so only Fast's first attempt counts.
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

test('the summary is the same in any input order', () => {
  const receipts = fixtureLedger();
  expect(summarizeCost(receipts.toReversed())).toEqual(summarizeCost(receipts));
});

test('a push that names the PRs it landed merges each of them, a queue entry ahead of the last included', () => {
  const receipts = [
    ...receiptsOf({ runUrl: run(21), event: 'integration', tree: tree('1'), prs: [21] }, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'check']) },
      { job: 'check', from: 1, to: 2, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(22), event: 'integration', tree: tree('2'), prs: [22] }, [
      { job: 'plan', from: 3, to: 4, extra: planned(['plan', 'check']) },
      { job: 'check', from: 4, to: 5, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(23), event: 'main', tree: tree('2'), prs: [21, 22] }, [
      { job: 'plan', from: 10, to: 11, extra: planned(['plan', 'check']) },
      { job: 'check', from: 11, to: 12, endOnly: true },
    ]),
  ];
  const summary = summarizeCost(receipts);
  // Each entry run is its PR's own; the push splits across both.
  expect(summary.merged).toEqual([
    {
      pr: 21,
      runs: 2,
      jobMs: 3 * MINUTE,
      machineStarts: 3,
      setupMs: 0,
      reuseHits: 0,
      executed: 0,
      readyToMergeMs: 10 * MINUTE,
    },
    {
      pr: 22,
      runs: 2,
      jobMs: 3 * MINUTE,
      machineStarts: 3,
      setupMs: 0,
      reuseHits: 0,
      executed: 0,
      readyToMergeMs: 7 * MINUTE,
    },
  ]);
});

test('a cancelled job whose runner clock runs ahead counts from its body start, as the writer does', () => {
  const base = { runUrl: run(1), event: 'pr' as const, tree: tree('a'), prs: [12] };
  const summary = summarizeCost(
    receiptsOf(base, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
      {
        job: 'fast',
        from: 3,
        to: null,
        extra: { cost: { machineStart: true, runnerStartedAt: at(8), setupMs: 0, wallMs: null } },
      },
      { job: 'check', from: 5, to: 6, status: 'failed', endOnly: true },
    ]),
  );
  // Plan 1, the cancelled Fast from minute 3 to the attempt's last receipt at 6, and Check 1.
  expect(summary.all.jobMs).toBe(5 * MINUTE);
});

test('ties in time resolve by run, so tied integration passes credit the same push in any order', () => {
  const tied = (number: number, pr: number): CiResult[] =>
    receiptsOf({ runUrl: run(number), event: 'integration', tree: tree('c'), prs: [pr] }, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'check']) },
      { job: 'check', from: 1, to: 2, endOnly: true },
    ]);
  const receipts = [
    ...tied(31, 31),
    ...tied(32, 32),
    ...receiptsOf({ runUrl: run(33), event: 'main', tree: tree('c'), prs: [] }, [
      { job: 'plan', from: 5, to: 6, extra: planned(['plan', 'check']) },
      { job: 'check', from: 6, to: 7, endOnly: true },
    ]),
  ];
  const summary = summarizeCost(receipts);
  expect(summary.merged.map((entry) => entry.pr)).toEqual([32]);
  expect(summarizeCost(receipts.toReversed())).toEqual(summary);
});

test('a rerun names its first attempt’s class even when only the rerun’s receipt is left', () => {
  const receipts = receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
    { job: 'fast', from: 10, to: 20, endOnly: true, extra: { attempt: 2, firstAttemptClass: 'environment' } },
  ]);
  expect(summarizeCost(receipts).firstAttemptFailures).toEqual({ environment: 1 });
});

test('a push that reused a tree counts every job its integration run ran or reused', () => {
  const receipts = [
    ...receiptsOf({ runUrl: run(3), event: 'integration', tree: tree('c'), prs: [12] }, [
      {
        job: 'plan',
        from: 0,
        to: 1,
        extra: planned(['plan', 'fast', 'check'], { reused: [{ job: 'sql', shard: null, runUrl: run(1) }] }),
      },
      { job: 'fast', from: 1, to: 5 },
      { job: 'check', from: 5, to: 6, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(4), event: 'main', tree: tree('c'), prs: [] }, [
      { job: 'plan', from: 10, to: 11, extra: { ...planned(['plan', 'check']), reusedFrom: run(3) } },
      { job: 'check', from: 11, to: 12, endOnly: true, extra: { reusedFrom: run(3) } },
    ]),
  ];
  // The integration run's SQL reuse and the push's Fast and SQL: three hits, one execution.
  expect(summarizeCost(receipts).merged[0]).toMatchObject({ pr: 12, reuseHits: 3, executed: 1 });
});

test('a push that reused a tree the input lacks counts one reuse hit, and lands no PR', () => {
  const push = fixtureLedger().filter((receipt) => receipt.runUrl === run(4));
  const summary = summarizeCost(push);
  expect(summary.merged).toEqual([]);
  expect(summary.other).toMatchObject({ runs: 1, reuseHits: 1, executed: 0 });
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
      spawnSync(process.execPath, ['scripts/ci-cost.ts', ...paths], { cwd: repository, encoding: 'utf8' });

    const fromLedger = cost('--json', ledger);
    expect([fromLedger.status, fromLedger.stderr]).toEqual([0, '']);
    expect(JSON.parse(fromLedger.stdout)).toEqual(JSON.parse(JSON.stringify(summarizeCost(receipts))));

    const fromFolder = cost('--json', join(folder, 'results'));
    expect(fromFolder.status).toBe(0);
    expect(JSON.parse(fromFolder.stdout)).toMatchObject({ cancelled: 1, neverStarted: 1, all: { runs: 1 } });

    const table = cost(ledger);
    expect(table.stdout).toContain('CI cost per merged pull request: 3 merged, 9 runs.');
    expect(table.stdout).toMatch(/^#12 +4 +95\.0 +18\.0 +17 % +36 % +40\.0 min$/m);

    writeFileSync(join(runFolder, 'broken.json'), '{');
    expect(cost(join(folder, 'results')).status).not.toBe(0);
    // A Boat record named by path must exist: a mistyped one would report no Boat runs at all.
    const missingBoat = cost('--boat', join(folder, 'missing.jsonl'), ledger);
    expect(missingBoat.status).not.toBe(0);
    expect(missingBoat.stderr).toContain('missing.jsonl does not exist');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a first-attempt Check that fails while every job passed counts as a failure of its own', () => {
  const receipts = receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
    { job: 'fast', from: 1, to: 10 },
    { job: 'check', from: 10, to: 11, status: 'failed', endOnly: true },
  ]);
  expect(summarizeCost(receipts).firstAttemptFailures).toEqual({ unclassified: 1 });
});

test('a run that names a PR twice splits its cost evenly across its distinct PRs', () => {
  const batch = (prs: number[]): CiResult[] => [
    ...receiptsOf({ runUrl: run(31), event: 'integration', tree: tree('3'), prs }, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'check']) },
      { job: 'check', from: 1, to: 3, endOnly: true },
    ]),
    ...receiptsOf({ runUrl: run(32), event: 'main', tree: tree('3'), prs: [12, 13] }, [
      { job: 'plan', from: 10, to: 11, extra: planned(['plan', 'check']) },
      { job: 'check', from: 11, to: 12, endOnly: true },
    ]),
  ];
  const summary = summarizeCost(batch([12, 12, 13]));
  expect(summary.merged.map((entry) => entry.jobMs)).toEqual([2.5 * MINUTE, 2.5 * MINUTE]);
  expect(summary).toEqual(summarizeCost(batch([12, 13])));
});

test('a first-attempt Check after a job that started only in the rerun counts no failure of its own', () => {
  const receipts = receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
    { job: 'check', from: 2, to: 3, status: 'failed', endOnly: true },
    { job: 'fast', from: 10, to: 20, extra: { attempt: 2 } },
    { job: 'check', from: 20, to: 21, endOnly: true, extra: { attempt: 2 } },
  ]);
  expect(summarizeCost(receipts).firstAttemptFailures).toEqual({});
});

test('a first-attempt Check answers to the first attempt’s Plan, not to a rerun’s Plan that reused the missing job', () => {
  const receipts = receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'sql', 'check']) },
    { job: 'fast', from: 1, to: 10 },
    { job: 'check', from: 10, to: 11, status: 'failed', endOnly: true },
    {
      job: 'plan',
      from: 20,
      to: 21,
      extra: {
        attempt: 2,
        ...planned(['plan', 'check'], { reused: [{ job: 'sql', shard: null, runUrl: run(9) }] }),
      },
    },
    { job: 'check', from: 21, to: 22, endOnly: true, extra: { attempt: 2 } },
  ]);
  expect(summarizeCost(receipts).firstAttemptFailures).toEqual({});
});

test('a failed job of an unknown attempt counts as no first-attempt failure', () => {
  const receipts = receiptsOf({ runUrl: run(1), event: 'pr', tree: tree('a'), prs: [12] }, [
    { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'fast', 'check']) },
    { job: 'fast', from: 1, to: 10, status: 'failed', extra: { attempt: null } },
    { job: 'check', from: 10, to: 11, status: 'failed', endOnly: true, extra: { attempt: null } },
  ]);
  expect(summarizeCost(receipts).firstAttemptFailures).toEqual({});
});

test('a full run whose final Check measured no selection misses leaves them unknown, never none', () => {
  const fullRun = (number: number, check: Partial<CiResult>): CiResult[] =>
    receiptsOf({ runUrl: run(number), event: 'full', tree: tree(String(number)), prs: [] }, [
      { job: 'plan', from: 0, to: 1, extra: planned(['plan', 'check']) },
      { job: 'check', from: 1, to: 2, endOnly: true, extra: check },
    ]);
  const measured = summarizeCost(fullRun(1, { unselectedFailures: [] }));
  expect(measured.unselectedFailures).toEqual([]);
  expect(formatCost(measured)).toContain('no plan selected: none.');
  const unknown = summarizeCost([...fullRun(1, { unselectedFailures: ['golden:p2-03'] }), ...fullRun(2, {})]);
  expect(unknown.unselectedFailures).toBeUndefined();
  expect(formatCost(unknown)).toContain('no plan selected: unknown');
  // A rerun's final Check answers for the run, not the first attempt's.
  const rerun = [
    ...fullRun(1, { unselectedFailures: ['golden:p2-03'] }),
    ...receiptsOf({ runUrl: run(1), event: 'full', tree: tree('1'), prs: [] }, [
      { job: 'check', from: 5, to: 6, endOnly: true, extra: { attempt: 2 } },
    ]),
  ];
  expect(summarizeCost(rerun).unselectedFailures).toBeUndefined();
});

test('Boat runs count beside CI to the merged PR whose run tested their commit, and elsewhere otherwise', () => {
  const boat = (machine: string, minute: number, head: string | null, dollars: number | null): BoatRun => ({
    version: 1,
    machine,
    startedAt: at(minute),
    completedAt: at(minute + 6),
    head,
    reports: [],
    usage: dollars === null ? null : { seconds: 600, dollars },
  });
  const receipts = fixtureLedger();
  const merged = 'c'.repeat(40);
  const summary = summarizeCost(receipts, [
    boat('bx_aaaaaaaa', 0, merged, 0.1),
    // The same kept machine: its total grew by 0.05 for this run.
    boat('bx_aaaaaaaa', 20, merged, 0.15),
    boat('bx_bbbbbbbb', 0, 'd'.repeat(40), 0.2),
    boat('bx_cccccccc', 0, null, null),
  ]);
  // Every fixture PR run tested commit c…: PRs 12 and 13; 13 never merged, so half of each run counts elsewhere.
  expect(summary.boat?.merged).toEqual([
    { pr: 12, runs: 1, wallMs: 6 * MINUTE, dollars: 0.075, withoutUsage: 0 },
  ]);
  expect(summary.boat?.elsewhere).toMatchObject({ runs: 3, wallMs: 18 * MINUTE, withoutUsage: 1 });
  expect(summary.boat?.all).toMatchObject({ runs: 4, wallMs: 24 * MINUTE, withoutUsage: 1 });
  expect(summary.boat?.all.dollars).toBeCloseTo(0.35);
  const table = formatCost(summary);
  expect(table).toMatch(/^#12 +1\.0 +6\.0 +\$0\.07$/m);
  expect(table).toContain("(1.0 runs without Boat's usage)");
  expect(formatCost(summarizeCost(receipts))).toContain('Boat verification: no Boat run records given');
});
