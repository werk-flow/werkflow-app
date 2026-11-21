// One CI run of one commit off GitHub Actions, as ci.yml runs it there (scripts/ci/run-commit.ts is
// its command). Plan runs on the orchestrator's host, then every job and shard the plan runs goes
// through an executor by the needs of lib/testing/ci/dag.ts, then Check runs on the host with the
// scheduler's report. The executor decides where a job runs: a process in its own checkout now, a
// container later. Each job takes `scripts/ci/prepare.ts for <job>`, then `scripts/ci/job.ts <job>`.
// This module decides; it starts nothing itself.
import { runPlanOf } from './check';
import { CI_DAG, type CiEvent, type CiJob } from './dag';
import type { CiResult, RunPlan } from './results';
import { jobShards } from './run-plan';
import { heldUntil } from './schedule';

/**
 * The file a run-commit holds in its run's results directory for the run's whole life: one
 * orchestrator per run, and scripts/ci/schedule.ts never names a run that holds it.
 */
export const RUN_COMMIT_LOCK = 'run-commit.lock';

/** One job, or one shard of a sharded job. */
export type Unit = { job: CiJob; shard: number | null };
export const unitName = (unit: Unit): string =>
  unit.shard === null ? unit.job : `${unit.job}-${unit.shard}`;

/** One job start: its environment steps, then its body, in a checkout of the run's commit. */
export type ExecutorTask = {
  unit: Unit;
  /** The job's environment, for its steps and its body. */
  env: Readonly<Record<string, string>>;
  /** Only the environment steps see these, never the body: the sibling clone's token. */
  prepareEnv: Readonly<Record<string, string>>;
  /** The whole job, setup included, as ci.yml's `timeout-minutes`. */
  timeoutMs: number;
};

/** How a job start ended: its body's exit code, or null when it never got one (setup failed, killed). */
export type ExecutorOutcome = { exitCode: number | null; detail: string };

/** Runs one job start. It ends the job at its timeout or when `signal` aborts, and then resolves. */
export type Executor = { run(task: ExecutorTask, signal: AbortSignal): Promise<ExecutorOutcome> };

type UnitState = 'waiting' | 'running' | 'passed' | 'failed' | 'skipped' | 'cancelled';
type SchedulerResult = 'success' | 'failure' | 'cancelled' | 'skipped';

export type RunCommitInput = {
  /** The run as every job sees it: its event, the commit's tree, its URL and attempt, and the runner. */
  run: {
    event: CiEvent;
    commit: string;
    tree: string;
    runUrl: string;
    attempt: number;
    producer: string | null;
  };
  /**
   * The run's variables, the same for every job: CI_EVENT, CI_RESULTS_DIR, CI_RUN_URL, CI_BASE_SHA
   * and the like, CI_LEDGER when the runner keeps one, the tokens.
   */
  env: Readonly<Record<string, string>>;
  /** The most jobs the executor runs at once. */
  parallel: number;
};

export type RunCommitDeps = {
  /** Plan and Check: the orchestrator's own host, which keeps the ledger. */
  host: Executor;
  /** Every other job: none of them sees the ledger. */
  jobs: Executor;
  /** A job's result in the run's results directory, or why it cannot be read. */
  readResult(unit: Unit): CiResult | { unreadable: string };
  /** Appends a receipt to the runner's ledger; absent without one. Throws when it cannot. */
  appendReceipt?: ((receipt: CiResult) => void) | undefined;
  /**
   * Posts the run's `Check` through the CI App's publisher (scripts/ci/publish-check.ts): `start`
   * before Plan, `finish` after Check. Absent when the runner posts no Check, such as for a queue
   * run. False when the post failed.
   */
  publish?: ((mode: 'start' | 'finish') => Promise<boolean>) | undefined;
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  log(line: string): void;
  /**
   * Calls `changed` whenever the job's result file changes, until the returned function stops it.
   * A missed change costs only the start receipt's timing: the end forwards whatever the job wrote.
   */
  watchResult(unit: Unit, changed: () => void): () => void;
};

export type RunCommitOutcome = {
  /** 0 when the run's Check passed. */
  exitCode: number;
  units: { unit: Unit; state: UnitState }[];
  scheduler: Partial<Record<CiJob, { result: SchedulerResult }>>;
};

/**
 * The environment of one job. Every job takes the run's attempt (CI_RUN_ATTEMPT): a rerun counts it
 * up, and a receipt without one is never reused. Only Plan and Check, on the orchestrator's host, see
 * the ledger; the orchestrator forwards the other jobs' receipts. A job gets the GitHub token only
 * when the DAG says it reads GitHub, and the sibling clone's token only reaches its environment step.
 */
function taskOf(input: RunCommitInput, unit: Unit): ExecutorTask {
  const { CI_LEDGER, GH_TOKEN, SIBLING_REPOSITORIES_TOKEN, ...shared } = input.env;
  const spec = CI_DAG[unit.job];
  const onHost = unit.job === 'plan' || unit.job === 'check';
  return {
    unit,
    env: {
      ...shared,
      CI_RUN_ATTEMPT: String(input.run.attempt),
      ...(unit.shard === null ? {} : { CI_SHARD: String(unit.shard) }),
      ...(onHost && CI_LEDGER ? { CI_LEDGER } : {}),
      ...(spec.githubToken && GH_TOKEN ? { GH_TOKEN } : {}),
    },
    prepareEnv:
      spec.prepare.includes('siblings') && SIBLING_REPOSITORIES_TOKEN ? { SIBLING_REPOSITORIES_TOKEN } : {},
    timeoutMs: spec.timeoutMinutes * 60_000,
  };
}

/** The jobs and shards the plan runs between Plan and Check. A shard list that cannot be read throws. */
function plannedUnits(plan: RunPlan): Unit[] {
  return plan.jobs
    .filter((job) => job !== 'plan' && job !== 'check')
    .flatMap(
      (job): Unit[] =>
        jobShards(job, plan)?.map((entry) => ({ job, shard: entry.shard })) ?? [{ job, shard: null }],
    );
}

/**
 * Whether a waiting unit starts, waits for its needs, or never starts. A need the plan does not run
 * holds no unit and stands; a need that failed, was skipped or was cancelled skips the unit, as a
 * failed need skips a job on GitHub Actions.
 */
function readiness(
  unit: Unit,
  units: readonly Unit[],
  states: ReadonlyMap<string, UnitState>,
): 'start' | 'wait' | 'skip' {
  const needed = units.filter((other) => CI_DAG[unit.job].needs.includes(other.job));
  const needStates = needed.map((other) => states.get(unitName(other)));
  if (needStates.some((state) => state === 'failed' || state === 'skipped' || state === 'cancelled'))
    return 'skip';
  return needStates.every((state) => state === 'passed') ? 'start' : 'wait';
}

/** The scheduler's report for Check, as ci.yml's `toJSON(needs)`. */
function schedulerReport(
  planPassed: boolean,
  units: readonly Unit[],
  states: ReadonlyMap<string, UnitState>,
): RunCommitOutcome['scheduler'] {
  const report: RunCommitOutcome['scheduler'] = { plan: { result: planPassed ? 'success' : 'failure' } };
  for (const job of CI_DAG.check.needs.filter((name) => name !== 'plan')) {
    const jobStates = units.filter((unit) => unit.job === job).map((unit) => states.get(unitName(unit)));
    report[job] = {
      result: jobStates.some((state) => state === 'failed')
        ? 'failure'
        : jobStates.some((state) => state === 'cancelled')
          ? 'cancelled'
          : jobStates.length && jobStates.every((state) => state === 'passed')
            ? 'success'
            : 'skipped',
    };
  }
  return report;
}

/**
 * Forwards a job's receipts to the ledger, which the job never sees: its start once its result shows
 * it running (`seen`, on each change of the file), and its end when it stopped. Only a result of this run, attempt, commit, tree and unit,
 * written after the job started, counts; anything else stays out of the ledger, and Check fails the
 * run on it.
 */
function receiptForwarder(
  input: RunCommitInput,
  deps: RunCommitDeps,
  unit: Unit,
  startedAt: number,
): { seen(): void; end(): void } {
  const append = deps.appendReceipt;
  let started = false;
  // A start receipt that could not reach the ledger fails the job when it ends, not the orchestrator.
  let failure: unknown;
  const own = (): CiResult | undefined => {
    const result = deps.readResult(unit);
    if ('unreadable' in result) return undefined;
    const run = input.run;
    const matches =
      result.job === unit.job &&
      result.shard === unit.shard &&
      result.event === run.event &&
      result.commit === run.commit &&
      result.tree === run.tree &&
      result.runUrl === run.runUrl &&
      result.attempt === run.attempt &&
      (result.producer === null || result.producer === run.producer) &&
      Date.parse(result.startedAt) >= startedAt;
    return matches ? result : undefined;
  };
  return {
    seen: () => {
      if (!append || started || failure !== undefined) return;
      const result = own();
      // job.ts's start receipt: running, with its planned groups and the Plan it runs under. Its
      // first write before it read the plan is no receipt yet.
      if (result?.status !== 'running' || result.planIdentity === undefined) return;
      try {
        append(result);
        started = true;
      } catch (error) {
        failure = error;
      }
    },
    end: () => {
      if (!append) return;
      if (failure !== undefined) throw failure;
      const result = own();
      if (!result) {
        deps.log(`[run] ${unitName(unit)}: no result of this run to forward to the ledger`);
        return;
      }
      if (result.status !== 'running' || !started) append(result);
    },
  };
}

/** Plan on the host, and the jobs and shards its plan runs; none when the plan cannot be used. */
async function planRun(
  input: RunCommitInput,
  deps: RunCommitDeps,
  signal: AbortSignal,
): Promise<{ passed: boolean; plan?: RunPlan; units: Unit[] }> {
  const planUnit: Unit = { job: 'plan', shard: null };
  const outcome = await deps.host.run(taskOf(input, planUnit), signal);
  deps.log(`[run] plan: ${outcome.detail}`);
  const { event, tree, runUrl, producer, attempt } = input.run;
  const planned = runPlanOf({ tree, event, runUrl, producer }, deps.readResult(planUnit));
  let problem: string | undefined;
  if ('problem' in planned) problem = planned.problem;
  else if (planned.result.attempt !== attempt)
    problem = `the plan is of attempt ${planned.result.attempt}, not ${attempt}`;
  else
    try {
      return { passed: outcome.exitCode === 0, plan: planned.plan, units: plannedUnits(planned.plan) };
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  deps.log(`[run] No job runs: ${problem}.`);
  return { passed: false, units: [] };
}

/** Starts one job or shard; the promise settles once its state and receipts are final. */
function startUnit(
  input: RunCommitInput,
  deps: RunCommitDeps,
  unit: Unit,
  signal: AbortSignal,
  states: Map<string, UnitState>,
): Promise<void> {
  const name = unitName(unit);
  states.set(name, 'running');
  deps.log(`[run] ${name}: started`);
  const forwarder = receiptForwarder(input, deps, unit, deps.now());
  const unwatch = deps.appendReceipt ? deps.watchResult(unit, forwarder.seen) : undefined;
  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  return deps.jobs
    .run(taskOf(input, unit), signal)
    .then(
      (outcome): UnitState => {
        deps.log(`[run] ${name}: ${outcome.detail}`);
        return signal.aborted ? 'cancelled' : outcome.exitCode === 0 ? 'passed' : 'failed';
      },
      (error: unknown): UnitState => {
        deps.log(`[run] ${name}: the executor failed: ${message(error)}`);
        return signal.aborted ? 'cancelled' : 'failed';
      },
    )
    .then((state) => {
      unwatch?.();
      try {
        forwarder.end();
        states.set(name, state);
      } catch (error) {
        // A receipt that cannot reach the ledger fails the job, as job.ts fails on it.
        deps.log(`[run] ${name}: its receipt could not reach the ledger: ${message(error)}`);
        states.set(name, 'failed');
      }
    });
}

/**
 * Whether a waiting unit starts now. The run's own held shards start here and nowhere else: the
 * scheduler never names a run its orchestrator holds (scripts/ci/schedule.ts), and job.ts midnight
 * fails before the hold ends. Returns the wait until the hold ends for a midnight job held now.
 */
function admit(
  unit: Unit,
  context: {
    units: readonly Unit[];
    states: Map<string, UnitState>;
    hold: ReturnType<typeof heldUntil>;
    now: number;
  },
  log: (line: string) => void,
): 'start' | 'wait' | number {
  const name = unitName(unit);
  const ready = readiness(unit, context.units, context.states);
  if (ready === 'skip') {
    context.states.set(name, 'skipped');
    log(`[run] ${name}: skipped, a job it needs did not pass`);
    return 'wait';
  }
  if (ready === 'wait' || unit.job !== 'midnight') return ready;
  const { hold } = context;
  if (!(hold instanceof Date)) {
    context.states.set(name, 'skipped');
    log(`[run] ${name}: skipped, ${hold?.unreadable ?? 'the plan holds no midnight hold'}`);
    return 'wait';
  }
  const left = hold.getTime() - context.now;
  return left > 0 ? left : 'start';
}

/** Runs the units by their needs, at most `parallel` at once, until none can start any more. */
async function runUnits(
  input: RunCommitInput,
  deps: RunCommitDeps,
  signal: AbortSignal,
  planned: { plan?: RunPlan; units: Unit[] },
): Promise<Map<string, UnitState>> {
  const { units } = planned;
  const states = new Map<string, UnitState>(units.map((unit) => [unitName(unit), 'waiting']));
  const hold = planned.plan ? heldUntil(planned.plan) : undefined;
  const running = new Map<string, Promise<void>>();
  let announced = false;
  for (;;) {
    let holdWait: number | undefined;
    for (const unit of units) {
      const name = unitName(unit);
      if (states.get(name) !== 'waiting') continue;
      if (signal.aborted) states.set(name, 'cancelled');
      if (states.get(name) !== 'waiting') continue;
      const admitted = admit(unit, { units, states, hold, now: deps.now() }, deps.log);
      if (typeof admitted === 'number') holdWait = admitted;
      else if (admitted === 'start' && running.size < input.parallel)
        running.set(
          name,
          startUnit(input, deps, unit, signal, states).then(() => {
            running.delete(name);
          }),
        );
    }
    if (holdWait === undefined && running.size === 0) return states;
    const wake = new AbortController();
    const waits = [...running.values()];
    if (holdWait !== undefined) {
      if (!announced)
        deps.log(
          `[run] The browser shards wait ${Math.ceil(holdWait / 60_000)} min for the midnight hold; no job machine waits.`,
        );
      announced = true;
      waits.push(deps.sleep(holdWait, AbortSignal.any([wake.signal, signal])));
    }
    await Promise.race(waits);
    wake.abort();
  }
}

/** Runs one commit's CI run: Plan, the plan's jobs through the executor, then Check. */
export async function runCommit(
  input: RunCommitInput,
  deps: RunCommitDeps,
  signal: AbortSignal,
): Promise<RunCommitOutcome> {
  if (deps.publish && !(await deps.publish('start'))) {
    deps.log('[run] The queued Check could not be posted, so the run does not start.');
    return { exitCode: 1, units: [], scheduler: {} };
  }
  const planned = await planRun(input, deps, signal);
  const states = await runUnits(input, deps, signal, planned);
  const scheduler = schedulerReport(planned.passed, planned.units, states);
  // Check runs even after a cancellation, as on GitHub: a cancelled run reports a failed Check.
  const checkTask = taskOf(input, { job: 'check', shard: null });
  const checkOutcome = await deps.host.run(
    { ...checkTask, env: { ...checkTask.env, CI_NEEDS: JSON.stringify(scheduler) } },
    new AbortController().signal,
  );
  deps.log(`[run] check: ${checkOutcome.detail}`);
  if (deps.publish && !(await deps.publish('finish')))
    deps.log('[run] The Check verdict could not be posted.');
  return {
    exitCode: checkOutcome.exitCode === 0 ? 0 : 1,
    units: planned.units.map((unit) => ({ unit, state: states.get(unitName(unit)) ?? 'waiting' })),
    scheduler,
  };
}
