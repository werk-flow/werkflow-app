// One commit's CI run off GitHub Actions (lib/testing/ci/run-commit.ts), driven with fake executors:
// Plan and Check on the orchestrator's host, every planned job and shard through the executor by the
// DAG's needs, the ledger out of the jobs' reach, the held shards started by their own run only, and
// a Check that runs whatever happened before it.
import { expect, test } from 'bun:test';
import type { CiJob } from './dag';
import type { CiResult, RunPlan } from './results';
import {
  type Executor,
  type ExecutorOutcome,
  type ExecutorTask,
  runCommit,
  type RunCommitDeps,
  type RunCommitInput,
  type Unit,
  unitName,
} from './run-commit';

const TREE = 'a'.repeat(40);
const COMMIT = 'c'.repeat(40);
const RUN_URL = 'https://ci.example/runs/1';
const START = Date.parse('2026-11-21T12:00:00.000Z');
const MINUTE = 60_000;

const OUTPUTS: Record<string, string> = {
  browser: 'true',
  full: 'false',
  full_reason: '',
  shards: JSON.stringify([
    { shard: 1, groups: 'golden:p1-01' },
    { shard: 2, groups: 'audit:lab:calendar' },
  ]),
  midnight_until: '',
  static: '',
  sql: '',
  selected_lint: 'static:lint',
  selected_static: '',
  selected_unit: 'unit:all',
  selected_sql: 'sql:grants',
  selected_components: 'ui:contracts:work',
  component_shards: JSON.stringify([{ shard: 1, groups: 'ui:contracts:work' }]),
  selected_invoices: '',
};
const PLAN: RunPlan = {
  jobs: ['plan', 'fast', 'sql', 'components', 'browser', 'check'],
  skips: { invoices: 'No e-invoice check.', midnight: 'No hold.' },
  shards: [
    { shard: 1, groups: 'golden:p1-01' },
    { shard: 2, groups: 'audit:lab:calendar' },
  ],
  outputs: OUTPUTS,
};
const HELD: RunPlan = {
  ...PLAN,
  jobs: [...PLAN.jobs, 'midnight'],
  skips: { invoices: 'No e-invoice check.' },
  outputs: { ...OUTPUTS, midnight_until: new Date(START + 30 * MINUTE).toISOString() },
};

const input = (overrides: Partial<RunCommitInput['run']> = {}, parallel = 4): RunCommitInput => ({
  run: {
    event: 'integration',
    commit: COMMIT,
    tree: TREE,
    runUrl: RUN_URL,
    attempt: 1,
    producer: 'mac-standin',
    ...overrides,
  },
  env: {
    CI_EVENT: 'integration',
    CI_RESULTS_DIR: '/runs/1',
    CI_RUN_URL: RUN_URL,
    CI_LEDGER: '/ledger/ci.jsonl',
    GH_TOKEN: 'github-token',
    SIBLING_REPOSITORIES_TOKEN: 'sibling-token',
  },
  parallel,
});

/** The Plan a job's result names once it read the plan, as job.ts writes it. */
const IDENTITY: CiResult['planIdentity'] = {
  runUrl: RUN_URL,
  attempt: 1,
  startedAt: new Date(START).toISOString(),
  base: 'b'.repeat(40),
  digest: '0'.repeat(64),
};

function result(unit: Unit, at: number, overrides: Partial<CiResult> = {}): CiResult {
  return {
    version: 1,
    job: unit.job,
    shard: unit.shard,
    event: 'integration',
    tree: TREE,
    commit: COMMIT,
    base: 'b'.repeat(40),
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: RUN_URL,
    startedAt: new Date(at).toISOString(),
    completedAt: new Date(at + 1000).toISOString(),
    attempt: 1,
    ...(unit.job === 'plan' ? {} : { planIdentity: IDENTITY }),
    ...overrides,
  };
}

type World = {
  deps: RunCommitDeps;
  /** Every start, in order, with where it ran. */
  starts: { place: 'host' | 'jobs'; task: ExecutorTask; at: number }[];
  ledger: CiResult[];
  log: string[];
  /** Most jobs that ran at once on the executor. */
  peak: () => number;
};

type WorldOptions = {
  plan?: RunPlan | null;
  planOverrides?: Partial<CiResult>;
  /** A job's exit code; 0 when unlisted. */
  exits?: Partial<Record<string, number>>;
  /** What a job writes while it runs, in place of its own running result. */
  written?: Partial<Record<string, (unit: Unit, at: number) => CiResult>>;
  appendFails?: boolean;
  publish?: (mode: 'start' | 'finish') => boolean;
  /** Called when a job starts, before it ends. */
  onStart?: (unit: Unit) => void;
};

function world(options: WorldOptions = {}): World {
  let clock = START;
  const results = new Map<string, CiResult>();
  const starts: World['starts'] = [];
  const ledger: CiResult[] = [];
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  const watchers = new Map<string, () => void>();
  const outcome = (unit: Unit): ExecutorOutcome => {
    const code = options.exits?.[unitName(unit)] ?? 0;
    return { exitCode: code, detail: `exit ${code}` };
  };
  const host: Executor = {
    run: async (task) => {
      starts.push({ place: 'host', task, at: clock });
      if (task.unit.job === 'plan' && options.plan !== null)
        results.set(
          'plan',
          result(task.unit, clock, { plan: options.plan ?? PLAN, ...options.planOverrides }),
        );
      return outcome(task.unit);
    },
  };
  const jobs: Executor = {
    run: async (task, signal) => {
      starts.push({ place: 'jobs', task, at: clock });
      active += 1;
      peak = Math.max(peak, active);
      const name = unitName(task.unit);
      const started = clock;
      results.set(
        name,
        options.written?.[name]?.(task.unit, started) ??
          result(task.unit, started, { status: 'running', completedAt: null }),
      );
      watchers.get(name)?.();
      options.onStart?.(task.unit);
      // Let the other units start, so the run's parallelism shows.
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (signal.aborted) return { exitCode: null, detail: 'stopped' };
      const ended = outcome(task.unit);
      if (!options.written?.[name])
        results.set(name, result(task.unit, started, { status: ended.exitCode === 0 ? 'passed' : 'failed' }));
      return ended;
    },
  };
  return {
    starts,
    ledger,
    log,
    peak: () => peak,
    deps: {
      host,
      jobs,
      readResult: (unit) => results.get(unitName(unit)) ?? { unreadable: `${unitName(unit)} is missing` },
      appendReceipt: (receipt) => {
        if (options.appendFails) throw new Error('the ledger is read-only');
        ledger.push(receipt);
      },
      publish: options.publish && (async (mode) => options.publish?.(mode) ?? true),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      log: (line) => log.push(line),
      watchResult: (unit, changed) => {
        watchers.set(unitName(unit), changed);
        return () => watchers.delete(unitName(unit));
      },
    },
  };
}

const started = (w: World): string[] =>
  w.starts.map((entry) => `${entry.place}:${unitName(entry.task.unit)}`);
const checkTask = (w: World): ExecutorTask | undefined =>
  w.starts.find((entry) => entry.task.unit.job === 'check')?.task;
const report = (w: World): Record<string, { result: string }> =>
  JSON.parse(checkTask(w)?.env.CI_NEEDS ?? '{}');

test('Plan and Check run on the host, every planned job and shard through the executor, Check last with the report', async () => {
  const w = world();
  const outcome = await runCommit(input(), w.deps, new AbortController().signal);
  expect(outcome.exitCode, w.log.join('\n')).toBe(0);
  expect(started(w).at(0)).toBe('host:plan');
  expect(started(w).at(-1)).toBe('host:check');
  expect(started(w).slice(1, -1).sort()).toEqual(
    ['jobs:browser-1', 'jobs:browser-2', 'jobs:components-1', 'jobs:fast', 'jobs:sql'].sort(),
  );
  expect(report(w)).toEqual({
    plan: { result: 'success' },
    fast: { result: 'success' },
    sql: { result: 'success' },
    components: { result: 'success' },
    invoices: { result: 'skipped' },
    midnight: { result: 'skipped' },
    browser: { result: 'success' },
  });
});

test('every job takes the attempt; only Plan and Check see the ledger; tokens reach only the jobs that read them', async () => {
  const w = world();
  await runCommit(input({ attempt: 3 }), w.deps, new AbortController().signal);
  for (const { place, task } of w.starts) {
    const name = unitName(task.unit);
    expect([name, task.env.CI_RUN_ATTEMPT]).toEqual([name, '3']);
    expect([name, task.env.CI_LEDGER]).toEqual([name, place === 'host' ? '/ledger/ci.jsonl' : undefined]);
    expect([name, task.env.GH_TOKEN]).toEqual([
      name,
      ['plan', 'fast'].includes(task.unit.job) ? 'github-token' : undefined,
    ]);
    expect([name, task.env.SIBLING_REPOSITORIES_TOKEN]).toEqual([name, undefined]);
    expect([name, task.prepareEnv.SIBLING_REPOSITORIES_TOKEN]).toEqual([
      name,
      task.unit.job === 'fast' ? 'sibling-token' : undefined,
    ]);
    expect([name, task.env.CI_SHARD]).toEqual([
      name,
      task.unit.shard === null ? undefined : String(task.unit.shard),
    ]);
  }
});

test('a browser shard starts only after Fast passed; a failed Fast skips them and Check gets the failure', async () => {
  const order: string[] = [];
  const passed = world({ onStart: (unit) => order.push(unit.job) });
  await runCommit(input(), passed.deps, new AbortController().signal);
  expect(order.indexOf('browser')).toBeGreaterThan(order.indexOf('fast'));
  expect(passed.starts.find((entry) => entry.task.unit.job === 'browser')?.at).toBeGreaterThanOrEqual(
    passed.starts.find((entry) => entry.task.unit.job === 'fast')?.at ?? Infinity,
  );

  const failed = world({ exits: { fast: 1, check: 1 } });
  const outcome = await runCommit(input(), failed.deps, new AbortController().signal);
  expect(started(failed)).not.toContain('jobs:browser-1');
  expect(report(failed).fast).toEqual({ result: 'failure' });
  expect(report(failed).browser).toEqual({ result: 'skipped' });
  expect(outcome.exitCode, failed.log.join('\n')).toBe(1);
});

test('held shards start from their own run once the hold ends, with no job machine waiting for it', async () => {
  const w = world({ plan: HELD });
  await runCommit(input(), w.deps, new AbortController().signal);
  const at = (job: CiJob) => w.starts.find((entry) => entry.task.unit.job === job)?.at ?? -1;
  expect(at('midnight')).toBe(START + 30 * MINUTE);
  expect(at('browser')).toBeGreaterThanOrEqual(at('midnight'));
  // Everything else ran before the hold ended.
  expect(at('fast')).toBe(START);
  expect(at('sql')).toBe(START);
  expect(report(w).midnight).toEqual({ result: 'success' });
});

test('a plan that holds the midnight job without a readable hold runs no browser shard', async () => {
  const w = world({ plan: { ...HELD, outputs: { ...HELD.outputs, midnight_until: 'soon' } } });
  const outcome = await runCommit(input(), w.deps, new AbortController().signal);
  expect(started(w)).not.toContain('jobs:midnight');
  expect(started(w)).not.toContain('jobs:browser-1');
  expect(report(w).browser).toEqual({ result: 'skipped' });
  expect(outcome.units.find((entry) => entry.unit.job === 'midnight')?.state).toBe('skipped');
});

test('the executor never runs more jobs at once than the runner allows', async () => {
  const w = world();
  await runCommit(input({}, 2), w.deps, new AbortController().signal);
  expect(w.peak()).toBe(2);
  expect(started(w)).toHaveLength(7);
});

test("a job's start and end reach the ledger through the orchestrator, and another run's result never does", async () => {
  const w = world({
    written: {
      sql: (unit, at) =>
        result(unit, at, { runUrl: 'https://ci.example/runs/other', status: 'running', completedAt: null }),
      'components-1': (unit, at) => result(unit, at, { attempt: 2, status: 'running', completedAt: null }),
      // Before job.ts read its plan, its result is no start receipt yet.
      invoices: (unit, at) =>
        result(unit, at, { status: 'running', completedAt: null, planIdentity: undefined }),
    },
    exits: { sql: 1, 'components-1': 1, check: 1 },
    plan: { ...PLAN, jobs: [...PLAN.jobs, 'invoices'], skips: { midnight: 'No hold.' } },
  });
  await runCommit(input(), w.deps, new AbortController().signal);
  const fast = w.ledger.filter((receipt) => receipt.job === 'fast').map((receipt) => receipt.status);
  expect(fast).toEqual(['running', 'passed']);
  expect(w.ledger.filter((receipt) => receipt.job === 'sql' || receipt.job === 'components')).toEqual([]);
  // A job that died before it read its plan still withdraws an earlier pass by its last result.
  expect(w.ledger.filter((receipt) => receipt.job === 'invoices').map((receipt) => receipt.status)).toEqual([
    'running',
  ]);
  expect(w.log.some((line) => line.includes('sql: no result of this run to forward'))).toBe(true);
  // Plan and Check append their own receipts on the host (scripts/ci/job.ts).
  expect(w.ledger.filter((receipt) => receipt.job === 'plan' || receipt.job === 'check')).toEqual([]);
});

test('a receipt that cannot reach the ledger fails its job', async () => {
  const w = world({ appendFails: true, exits: { check: 1 } });
  const outcome = await runCommit(input(), w.deps, new AbortController().signal);
  expect(outcome.units.find((entry) => entry.unit.job === 'fast')?.state).toBe('failed');
  expect(report(w).fast).toEqual({ result: 'failure' });
});

test('a plan of another attempt or a failed plan runs no job, and Check still runs and fails the run', async () => {
  for (const options of [{ planOverrides: { attempt: 1 } }, { plan: null }, { exits: { plan: 1 } }]) {
    const w = world({ ...options, exits: { ...('exits' in options ? options.exits : {}), check: 1 } });
    const outcome = await runCommit(input({ attempt: 2 }), w.deps, new AbortController().signal);
    expect(started(w)).toEqual(['host:plan', 'host:check']);
    expect(report(w).plan).toEqual({ result: 'failure' });
    expect(outcome.exitCode, w.log.join('\n')).toBe(1);
  }
});

test('a stopped run cancels its jobs, starts no other, and still runs Check', async () => {
  const controller = new AbortController();
  const w = world({ onStart: (unit) => unit.job === 'fast' && controller.abort(), exits: { check: 1 } });
  const outcome = await runCommit(input({}, 1), w.deps, controller.signal);
  expect(started(w)).toEqual(['host:plan', 'jobs:fast', 'host:check']);
  expect(report(w).fast).toEqual({ result: 'cancelled' });
  expect(outcome.exitCode, w.log.join('\n')).toBe(1);
});

test('the queued Check is posted before Plan, and a run whose start post failed runs nothing', async () => {
  const posts: string[] = [];
  const w = world({ publish: (mode) => (posts.push(`${mode}:${started(w).length}`), true) });
  await runCommit(input(), w.deps, new AbortController().signal);
  expect(posts).toEqual(['start:0', `finish:${started(w).length}`]);

  const refused = world({ publish: () => false });
  const refusedRun = await runCommit(input(), refused.deps, new AbortController().signal);
  expect(refusedRun.exitCode, refused.log.join('\n')).toBe(1);
  expect(started(refused)).toEqual([]);
});
