// One commit's CI run off GitHub Actions (lib/testing/ci/run-commit.ts), driven with fake executors:
// Plan and Check on the orchestrator's host, every planned job and shard through the executor by the
// DAG's needs, the ledger out of the jobs' reach, the held shards started by their own run only, and
// a Check that runs whatever happened before it.
import { expect, test } from 'bun:test';
import { planIdentityOf } from './check';
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
  /** `own` is what job.ts records of its run: the run's attempt and the Plan it runs under. */
  written?: Partial<Record<string, (unit: Unit, at: number, own: Partial<CiResult>) => CiResult>>;
  appendFails?: boolean;
  publish?: (mode: 'start' | 'finish') => boolean;
  /** Called when a job starts, before it ends. */
  onStart?: (unit: Unit) => void;
  /** Whether the executor runs jobs where they cannot write the ledger; default true. */
  isolated?: boolean;
  /** What Check writes as its result: by default its exit's, as job.ts does; `nothing` writes none. */
  checkWrites?: CiResult['status'] | 'nothing';
  checkOverrides?: Partial<CiResult>;
  /** Writing a result back fails. */
  writeFails?: boolean;
  /** Whether Plan reaches its body (its setup passed); default true. */
  planLaunches?: boolean;
};

function world(options: WorldOptions = {}): World {
  let clock = START;
  const results = new Map<string, CiResult>();
  const starts: World['starts'] = [];
  const ledger: CiResult[] = [];
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  // The Plan every job's result names, as job.ts records it once it read the plan.
  let identity: CiResult['planIdentity'];
  const outcome = (unit: Unit): ExecutorOutcome => {
    const code = options.exits?.[unitName(unit)] ?? 0;
    return { exitCode: code, detail: `exit ${code}` };
  };
  const host: Executor = {
    run: async (task) => {
      starts.push({ place: 'host', task, at: clock });
      // As the process executor: the task learns of its body's launch first, and a launch that
      // cannot be recorded never starts the body.
      if (task.unit.job === 'plan' && options.planLaunches === false)
        return { exitCode: 1, detail: 'its environment steps failed' };
      try {
        task.onLaunch?.();
      } catch (error) {
        return { exitCode: null, detail: `its launch could not be recorded: ${String(error)}` };
      }
      const attempt = Number(task.env.CI_RUN_ATTEMPT);
      if (task.unit.job === 'plan' && options.plan !== null) {
        const plan = result(task.unit, clock, {
          attempt,
          plan: options.plan ?? PLAN,
          ...options.planOverrides,
        });
        results.set('plan', plan);
        identity = planIdentityOf(plan, plan.plan ?? PLAN);
      }
      const ended = outcome(task.unit);
      const checkStatus = options.checkWrites ?? (ended.exitCode === 0 ? 'passed' : 'failed');
      if (task.unit.job === 'check' && checkStatus !== 'nothing')
        results.set(
          'check',
          result(task.unit, clock, { attempt, status: checkStatus, ...options.checkOverrides }),
        );
      return ended;
    },
    isolatesJobs: true,
  };
  const jobs: Executor = {
    run: async (task, signal) => {
      starts.push({ place: 'jobs', task, at: clock });
      active += 1;
      peak = Math.max(peak, active);
      const name = unitName(task.unit);
      const started = clock;
      const own: Partial<CiResult> = { attempt: Number(task.env.CI_RUN_ATTEMPT), planIdentity: identity };
      results.set(
        name,
        options.written?.[name]?.(task.unit, started, own) ??
          result(task.unit, started, { ...own, status: 'running', completedAt: null }),
      );
      options.onStart?.(task.unit);
      // Let the other units start, so the run's parallelism shows.
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (signal.aborted) return { exitCode: null, detail: 'stopped' };
      const ended = outcome(task.unit);
      if (!options.written?.[name])
        results.set(
          name,
          result(task.unit, started, { ...own, status: ended.exitCode === 0 ? 'passed' : 'failed' }),
        );
      return ended;
    },
    isolatesJobs: options.isolated ?? true,
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
      writeResult: (unit, written) => {
        if (options.writeFails) throw new Error('the results directory is read-only');
        results.set(unitName(unit), written);
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
  // The planned jobs ran too, not only Plan and Check.
  expect(started(w)).toContain('jobs:fast');
  expect(started(w)).toContain('jobs:browser-2');
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

test("a job's start reaches the ledger before it runs, and its end only as its own result of this run and Plan", async () => {
  const seenAtStart: string[] = [];
  const w = world({
    written: {
      // Each differs from the job's own result in one field only.
      sql: (unit, at, own) =>
        result(unit, at, {
          ...own,
          runUrl: 'https://ci.example/runs/other',
          status: 'running',
          completedAt: null,
        }),
      'components-1': (unit, at, own) =>
        result(unit, at, { ...own, attempt: 2, status: 'running', completedAt: null }),
      // Before job.ts read its plan, its result names no Plan.
      invoices: (unit, at, own) =>
        result(unit, at, { ...own, planIdentity: undefined, status: 'running', completedAt: null }),
    },
    exits: { sql: 1, 'components-1': 1, check: 1 },
    plan: { ...PLAN, jobs: [...PLAN.jobs, 'invoices'], skips: { midnight: 'No hold.' } },
    onStart: (unit) => {
      if (unit.job === 'sql')
        seenAtStart.push(
          ...w.ledger.filter((receipt) => receipt.job === 'sql').map((receipt) => receipt.status),
        );
    },
  });
  await runCommit(input(), w.deps, new AbortController().signal);
  // The start is the orchestrator's, appended before the job ran, with its planned groups and Plan.
  expect(seenAtStart).toEqual(['running']);
  const sqlStart = w.ledger.find((receipt) => receipt.job === 'sql');
  // The planned groups and steps, as job.ts records them (plannedGroups in run-plan.ts).
  expect(sqlStart?.groups.map((group) => [group.id, group.outcome])).toEqual([
    ['sql:grants', 'not-run'],
    ['step:types', 'not-run'],
    ['step:seed', 'not-run'],
  ]);
  expect(sqlStart?.planIdentity).toBeDefined();
  const statuses = (job: CiJob) =>
    w.ledger.filter((receipt) => receipt.job === job).map((receipt) => receipt.status);
  expect(statuses('fast')).toEqual(['running', 'passed']);
  // Another run's, another attempt's or a Plan-less result never reaches the ledger: the start ends failed.
  for (const job of ['sql', 'components', 'invoices'] as const)
    expect([job, statuses(job)]).toEqual([job, ['running', 'failed']]);
  expect(w.ledger.find((receipt) => receipt.job === 'sql' && receipt.status === 'failed')?.runUrl).toBe(
    RUN_URL,
  );
  // Plan and Check append their own receipts on the host (scripts/ci/job.ts).
  expect(statuses('plan')).toEqual([]);
});

test('a job that wrote a pass but did not pass reaches the ledger failed', async () => {
  const w = world({
    // Its own result in every field: only the executor's verdict differs.
    written: { sql: (unit, at, own) => result(unit, at, { ...own, status: 'passed' }) },
    exits: { sql: 1, check: 1 },
  });
  await runCommit(input(), w.deps, new AbortController().signal);
  expect(w.ledger.filter((receipt) => receipt.job === 'sql').map((receipt) => receipt.status)).toEqual([
    'running',
    'failed',
  ]);
  expect(w.ledger.at(-1)?.planIdentity).toBeDefined();
});

test('a job that passed but left a result that is not its own fails, and nothing that needs it starts', async () => {
  const w = world({
    written: { fast: (unit, at, own) => result(unit, at, { ...own, attempt: 2 }) },
    exits: { check: 1 },
  });
  const outcome = await runCommit(input(), w.deps, new AbortController().signal);
  expect(outcome.units.find((entry) => entry.unit.job === 'fast')?.state).toBe('failed');
  expect(started(w)).not.toContain('jobs:browser-1');
  expect(report(w).browser).toEqual({ result: 'skipped' });
});

test('a job that exited 0 but wrote a failure, or a pass without completion, fails, and nothing that needs it starts', async () => {
  const writes: ((unit: Unit, at: number, own: Partial<CiResult>) => CiResult)[] = [
    (unit, at, own) => result(unit, at, { ...own, status: 'failed' }),
    (unit, at, own) => result(unit, at, { ...own, status: 'passed', completedAt: null }),
  ];
  for (const fast of writes) {
    const w = world({ written: { fast }, exits: { check: 1 } });
    const outcome = await runCommit(input(), w.deps, new AbortController().signal);
    expect(outcome.units.find((entry) => entry.unit.job === 'fast')?.state, w.log.join('\n')).toBe('failed');
    expect(started(w)).not.toContain('jobs:browser-1');
    expect(w.ledger.filter((receipt) => receipt.job === 'fast').at(-1)?.status).toBe('failed');
  }
});

test("without a ledger too, a job that passed but left another attempt's result fails, and nothing that needs it starts", async () => {
  const w = world({
    isolated: false,
    written: { fast: (unit, at, own) => result(unit, at, { ...own, attempt: 2 }) },
    exits: { check: 1 },
  });
  const outcome = await runCommit(input(), w.deps, new AbortController().signal);
  expect(w.ledger).toEqual([]);
  expect(outcome.units.find((entry) => entry.unit.job === 'fast')?.state).toBe('failed');
  expect(started(w)).not.toContain('jobs:browser-1');
  expect(report(w).fast).toEqual({ result: 'failure' });
  expect(report(w).browser).toEqual({ result: 'skipped' });
});

test('an executor whose jobs could write the ledger keeps none: no job sees it and nothing is appended', async () => {
  const w = world({ isolated: false });
  await runCommit(input(), w.deps, new AbortController().signal);
  expect(w.starts.map((entry) => entry.task.env.CI_LEDGER)).toEqual(w.starts.map(() => undefined));
  expect(w.ledger).toEqual([]);
  expect(w.log.some((line) => line.includes('keeps no ledger and reuses nothing'))).toBe(true);
});

test('a Check that wrote a pass but did not pass is set failed, in its result and the ledger, before its verdict is posted', async () => {
  const posted: string[] = [];
  const w = world({
    checkWrites: 'passed',
    exits: { check: 1 },
    publish: (mode) => {
      const check = w.deps.readResult({ job: 'check', shard: null });
      posted.push(`${mode}:${'unreadable' in check ? 'none' : check.status}`);
      return true;
    },
  });
  await runCommit(input(), w.deps, new AbortController().signal);
  expect(posted).toEqual(['start:none', 'finish:failed']);
  expect(w.ledger.filter((receipt) => receipt.job === 'check').map((receipt) => receipt.status)).toEqual([
    'failed',
  ]);

  // When the failure cannot be recorded, no verdict is posted: the queued Check never turns green.
  const unposted: string[] = [];
  const stuck = world({
    checkWrites: 'passed',
    exits: { check: 1 },
    writeFails: true,
    publish: (mode) => (unposted.push(mode), true),
  });
  await runCommit(input(), stuck.deps, new AbortController().signal);
  expect(unposted).toEqual(['start']);
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

test('a Check that exited 0 passes the run only with its completed passing result of this run', async () => {
  const passes = async (options: WorldOptions): Promise<boolean> => {
    const w = world(options);
    return (await runCommit(input({ attempt: 2 }), w.deps, new AbortController().signal)).exitCode === 0;
  };
  expect(await passes({})).toBe(true);
  expect(await passes({ checkWrites: 'nothing' })).toBe(false);
  expect(await passes({ checkWrites: 'running' })).toBe(false);
  // A pass of the earlier attempt left in place, or another job's result, never stands for this one.
  expect(await passes({ checkOverrides: { attempt: 1 } })).toBe(false);
  expect(await passes({ checkOverrides: { job: 'fast' } })).toBe(false);
});

test('the queued Check is posted before Plan, and a run whose start post failed runs nothing and exits as not run', async () => {
  const posts: string[] = [];
  const w = world({ publish: (mode) => (posts.push(`${mode}:${started(w).length}`), true) });
  await runCommit(input(), w.deps, new AbortController().signal);
  expect(posts).toEqual(['start:0', `finish:${started(w).length}`]);

  const refused = world({ publish: () => false });
  const refusedRun = await runCommit(input(), refused.deps, new AbortController().signal);
  // 2, not run: the queue keeps an owed main run until a run of it starts (scripts/ci/queue.ts).
  expect(refusedRun.exitCode, refused.log.join('\n')).toBe(2);
  expect(started(refused)).toEqual([]);
});

test('a run whose Check verdict could not be posted exits 4, never 0, so its caller posts it again', async () => {
  for (const check of [0, 1]) {
    const w = world({ exits: { check }, publish: (mode) => mode === 'start' });
    const outcome = await runCommit(input(), w.deps, new AbortController().signal);
    expect([check, outcome.exitCode], w.log.join('\n')).toEqual([check, 4]);
    expect(w.log).toContain('[run] The Check verdict could not be posted, so Check stays queued.');
  }
});

// The queue clears an owed main run only by the run's start record (scripts/ci/queue-adapter.ts,
// runMain), and a second main run of the commit stops by it: one record, written once Plan launched.
test("a run records its start once Plan's body launched; a failure before it is a run not started", async () => {
  const order: string[] = [];
  const w = world({ publish: (mode) => (order.push(mode), true) });
  const run = await runCommit(
    input(),
    { ...w.deps, acknowledgeStart: () => order.push(`acknowledged:${started(w).join(',')}`) },
    new AbortController().signal,
  );
  expect(run.exitCode, w.log.join('\n')).toBe(0);
  expect(order).toEqual(['start', 'acknowledged:host:plan', 'finish']);
  // Only Plan's launch records it: once.
  expect(order.filter((entry) => entry.startsWith('acknowledged'))).toHaveLength(1);

  const unposted = world({ publish: () => false });
  const acknowledged: string[] = [];
  await runCommit(
    input(),
    { ...unposted.deps, acknowledgeStart: () => acknowledged.push('acknowledged') },
    new AbortController().signal,
  );
  expect(acknowledged).toEqual([]);

  // A launch that cannot be recorded starts no Plan body, no job and no Check: the run never started.
  const unacknowledged = world();
  const refused = await runCommit(
    input(),
    {
      ...unacknowledged.deps,
      acknowledgeStart: () => {
        throw new Error('the work directory is read-only');
      },
    },
    new AbortController().signal,
  );
  expect(refused.exitCode, unacknowledged.log.join('\n')).toBe(2);
  expect(started(unacknowledged)).toEqual(['host:plan']);
});

test('a Plan whose setup failed before its body is a started run: its start is recorded after it, and Check fails the run', async () => {
  // Check finds no plan, so it fails, as job.ts check does.
  const w = world({ planLaunches: false, exits: { check: 1 } });
  const order: string[] = [];
  const run = await runCommit(
    input(),
    { ...w.deps, acknowledgeStart: () => order.push(`acknowledged:${started(w).join(',')}`) },
    new AbortController().signal,
  );
  expect(run.exitCode, w.log.join('\n')).toBe(1);
  expect(order).toEqual(['acknowledged:host:plan']);
  expect(started(w)).toEqual(['host:plan', 'host:check']);
});

// A stop that ends Plan before its body launched is no run that started: the queue's owed main run
// stays owed, and a second main run of the commit still runs it.
test("a run stopped before Plan's body launched records no start, runs no job or Check, and exits as not run", async () => {
  const controller = new AbortController();
  controller.abort();
  const w = world({ planLaunches: false });
  const acknowledged: string[] = [];
  const run = await runCommit(
    input(),
    { ...w.deps, acknowledgeStart: () => acknowledged.push('acknowledged') },
    controller.signal,
  );
  expect(run.exitCode, w.log.join('\n')).toBe(2);
  expect(acknowledged).toEqual([]);
  expect(started(w)).toEqual(['host:plan']);
});
