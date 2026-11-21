// One CI run of one commit off GitHub Actions, as ci.yml runs it there (scripts/ci/run-commit.ts is
// its command). Plan runs on the orchestrator's host, then every job and shard the plan runs goes
// through an executor by the needs of lib/testing/ci/dag.ts, then Check runs on the host with the
// scheduler's report. The executor decides where a job runs (Executors): an isolating one, a container
// per job or a machine of its own, for CI; the process executor, which isolates nothing, for local
// and test runs only. Each job takes `scripts/ci/prepare.ts for <job>`, then `scripts/ci/job.ts <job>`.
// This module decides; it starts nothing itself.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { runPlanOf } from './check';
import { CI_DAG, type CiEvent, type CiJob } from './dag';
import type { CiResult, RunPlan } from './results';
import { endReceipt, type ReceiptRun, startReceipt } from './run-commit-receipts';
import { jobShards } from './run-plan';
import { heldUntil } from './schedule';

/**
 * The file a run-commit holds in its run's results directory for the run's whole life: one
 * orchestrator per run, and scripts/ci/schedule.ts never names a run that holds it.
 */
export const RUN_COMMIT_LOCK = 'run-commit.lock';

/**
 * Claims main's run of `commit` on this host for `runUrl`, atomically: a file named by the commit in
 * `folder` holds the first claimant's run. The same run claims again on a rerun or retry; any other
 * learns the owner and runs nothing.
 */
export function claimMainRun(
  folder: string,
  commit: string,
  runUrl: string,
): { claimed: true } | { owner: string } | { unwritable: string } {
  const claim = join(folder, commit);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(claim, runUrl, { flag: 'wx' });
    return { claimed: true };
  } catch (error) {
    if (!existsSync(claim)) return { unwritable: `${claim} cannot be written: ${message(error)}` };
    const owner = readFileSync(claim, 'utf8');
    return owner === runUrl ? { claimed: true } : { owner };
  }
}

/**
 * Gives up `runUrl`'s claim of main's run of `commit` when that run never started, such as when its
 * queued Check could not be posted: the next starter of the commit claims it. Another run's claim stays.
 */
export function releaseMainRun(folder: string, commit: string, runUrl: string): void {
  const claim = join(folder, commit);
  if (existsSync(claim) && readFileSync(claim, 'utf8') === runUrl) rmSync(claim);
}

/**
 * The one start record of main's run of `commit` on the host whose work root is `workRoot`: written
 * once that run's Plan launched (runCommit, acknowledgeStart), by a run through an isolating
 * executor only. A second starter of the commit exits 3
 * only by it, and the queue clears an owed main run only by it (scripts/ci/queue-adapter.ts, runMain).
 */
export const mainStartRecord = (workRoot: string, commit: string): string =>
  join(workRoot, 'main-runs', `${commit}.started`);

const startAckSchema = z
  .object({ commit: z.string().regex(/^[0-9a-f]{40}$/), runUrl: z.string().min(1) })
  .strict();

/**
 * Records durably at `path` that `runUrl`'s run of `commit` started: written to a flushed file of its
 * own and renamed into place, so a crash leaves it whole or absent.
 */
export function acknowledgeStart(path: string, ack: { commit: string; runUrl: string }): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(startAckSchema.parse(ack))}\n`, { flush: true });
  renameSync(`${path}.tmp`, path);
}

/** The run whose start of `commit` the record at `path` acknowledges, or undefined. */
export function acknowledgedStart(path: string, commit: string): string | undefined {
  try {
    const ack = startAckSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return ack.success && ack.data.commit === commit ? ack.data.runUrl : undefined;
  } catch {
    return undefined;
  }
}

/** The run variables a runner passes to its jobs as they are (scripts/ci/job.ts names them). */
const RUN_VARIABLES = [
  'CI_EVENT',
  'CI_RESULTS_DIR',
  'CI_RUN_URL',
  'CI_BASE_SHA',
  'CI_FULL_REASON',
  'CI_PRODUCER',
  'CI_PRS',
  'CI_PR_HEAD_REF',
  'CI_PR_HEAD_SHA',
  'CI_FIRST_ATTEMPT_CLASS',
  'SHRINK_ONLY_GROWTH_APPROVED',
  'GITHUB_REPOSITORY',
  'CI_CACHE_DIR',
  'SIBLING_REPOSITORIES_TOKEN',
] as const;

/**
 * The run's variables from the runner's environment. The runner's own GH_TOKEN, which may merge
 * PRs or post statuses, never reaches a job: a job that reads GitHub gets CI_JOB_GH_TOKEN, a
 * read-only token the runner supplies, as its GH_TOKEN. Nothing else of the runner passes: not its
 * ledger, publisher, work root or queue state.
 */
export function runVariables(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const name of RUN_VARIABLES) {
    const value = environment[name];
    if (value) variables[name] = value;
  }
  if (environment.CI_JOB_GH_TOKEN) variables.GH_TOKEN = environment.CI_JOB_GH_TOKEN;
  return variables;
}

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
  /**
   * Called once the job's steps passed and its body's process exists, never before: a crash before
   * the launch never leaves a launch behind. A throw ends the body at once, and the job fails.
   */
  onLaunch?: (() => void) | undefined;
};

/** How a job start ended: its body's exit code, or null when it never got one (setup failed, killed). */
export type ExecutorOutcome = { exitCode: number | null; detail: string };

/** Runs one job start. It ends the job at its timeout or when `signal` aborts, and then resolves. */
export type Executor = {
  run(task: ExecutorTask, signal: AbortSignal): Promise<ExecutorOutcome>;
  /**
   * Whether no job, Plan and Check included, reaches the orchestrator's files, ledger and
   * credentials: each runs in a container or on a machine of its own. Only then may a run keep a
   * ledger, come from the merge queue, post its Check or hold a credential (isolationProblem).
   */
  isolatesJobs: boolean;
};

/** What scripts/ci/run-commit.ts hands an executor for one run. */
export type ExecutorSetup = {
  /** The orchestrator's trusted clone, which holds the commit and GitHub's branches as `origin`. */
  source: string;
  commit: string;
  /** The host's work root (CI_WORK_ROOT), which only the orchestrator writes. */
  workRoot: string;
  /** The run's key, unique per run URL and attempt. */
  runKey: string;
  /** CI_DEDICATED_HOST: this host's Docker serves CI alone. */
  replaceStack: boolean;
  log(line: string): void;
};

/**
 * Where one run's jobs run: Plan and Check on the orchestrator's host (`host`), every other job and
 * shard through `jobs`. An isolating executor, a container per job on the Mac or a mirror job on
 * GitHub (scripts/ci/mirror-executor.ts), plugs in here with `isolatesJobs` on both;
 * scripts/ci/process-executor.ts is the local one.
 */
export type Executors = {
  host: Executor;
  jobs: Executor;
  /** Frees what the run left once it ended; a failed job's workspace may stay for a person. */
  release(outcome: RunCommitOutcome): void | Promise<void>;
};

/** What only a run through an isolating executor may hold, and why. */
const NEEDS_ISOLATION = {
  CI_LEDGER: 'a ledger',
  CI_QUEUE_COMMIT: "the merge queue's --runner",
  CI_QUEUE_MAIN_RUN: "the merge queue's --main-runner",
  CI_PUBLISHER: 'the Check publisher',
  GH_TOKEN: 'a GitHub token',
  GITHUB_TOKEN: 'a GitHub token',
  CI_JOB_GH_TOKEN: "the jobs' GitHub token",
  SIBLING_REPOSITORIES_TOKEN: 'the sibling token',
  CI_MIRROR_TOKEN: "the CI mirror's token",
} as const;

/**
 * Why a run cannot go through executors that do not isolate its jobs (`isolatesJobs` false), or
 * undefined: a job would reach the ledger, the queue's state and hooks, the publisher or a credential.
 */
export function isolationProblem(
  isolatesJobs: boolean,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (isolatesJobs) return undefined;
  const configured = Object.entries(NEEDS_ISOLATION).flatMap(([name, what]) =>
    environment[name] ? [`${name} (${what})`] : [],
  );
  if (!configured.length) return undefined;
  return `The process executor runs every job as this user on this host, so it serves local and test runs only, without ${configured.join(', ')}. Run CI through an executor that isolates each job: a container per job on the Mac, or a CI mirror job on GitHub.`;
}

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
  /** Overwrites a job's result in the run's results directory. */
  writeResult(unit: Unit, result: CiResult): void;
  /**
   * Posts the run's `Check` through the CI App's publisher (scripts/ci/publish-check.ts): `start`
   * before Plan, `finish` after Check. Absent when the runner posts no Check, such as for a queue
   * run. False when the post failed.
   */
  publish?: ((mode: 'start' | 'finish') => Promise<boolean>) | undefined;
  /**
   * Records durably that the run started, once Plan's body launched, or once Plan's setup failed
   * before its body (a run that started and fails; a stop before the body is no start). A second main run of the commit and the
   * queue's owed main run read it (mainStartRecord). Throws when it cannot; Plan's body then does
   * not start, and neither does the run.
   */
  acknowledgeStart?: (() => void) | undefined;
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  log(line: string): void;
};

export type RunCommitOutcome = {
  /**
   * 0 when the run's Check passed, 1 when it failed, 2 when the run never started because its queued
   * Check could not be posted, its start could not be recorded or a stop ended Plan before its body:
   * no job body ran, so the run is still owed. 4 when Check ran but its verdict could not be posted.
   */
  exitCode: 0 | 1 | 2 | 4;
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

type Planned = { passed: boolean; units: Unit[]; owner?: ReceiptRun['plan'] };

/**
 * Plan on the host, and the jobs and shards its plan runs. None run when Plan failed, or its plan is
 * not this run's and attempt's. The run's start is recorded once Plan's body launched, or once Plan's
 * setup failed before it; 'unstarted' when that record failed, or a stop ended Plan before its body.
 */
async function planRun(
  input: RunCommitInput,
  deps: RunCommitDeps,
  signal: AbortSignal,
): Promise<Planned | 'unstarted'> {
  const planUnit: Unit = { job: 'plan', shard: null };
  const start: { launched: boolean; failure?: string } = { launched: false };
  const record = (): void => {
    start.launched = true;
    try {
      deps.acknowledgeStart?.();
    } catch (error) {
      start.failure = message(error);
      throw error;
    }
  };
  const outcome = await deps.host.run({ ...taskOf(input, planUnit), onLaunch: record }, signal);
  deps.log(`[run] plan: ${outcome.detail}`);
  if (!start.launched && signal.aborted) {
    deps.log('[run] The run was stopped before Plan began, so it did not start.');
    return 'unstarted';
  }
  // A Plan whose setup failed before its body is a run that started, and fails.
  if (!start.launched)
    try {
      record();
    } catch {
      // Logged below.
    }
  if (start.failure !== undefined) {
    deps.log(`[run] The run's start could not be recorded, so it does not start: ${start.failure}`);
    return 'unstarted';
  }
  const { event, tree, runUrl, producer, attempt } = input.run;
  const planned = runPlanOf({ tree, event, runUrl, producer }, deps.readResult(planUnit));
  let problem: string | undefined;
  if (outcome.exitCode !== 0) problem = 'Plan did not pass';
  else if ('problem' in planned) problem = planned.problem;
  else if (planned.result.attempt !== attempt)
    problem = `the plan is of attempt ${planned.result.attempt}, not ${attempt}`;
  else
    try {
      return { passed: true, units: plannedUnits(planned.plan), owner: planned };
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  deps.log(`[run] No job runs: ${problem}.`);
  return { passed: false, units: [] };
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Starts one job or shard; the promise settles once its state and receipts are final. A job passes
 * only when the executor saw it pass and its result is its own of this run, attempt and Plan, with a
 * ledger or without one. With a ledger, the start receipt goes in before the job begins, and a start
 * that cannot be recorded fails the job unstarted; the end receipt follows the job's state.
 */
async function startUnit(
  input: RunCommitInput,
  deps: RunCommitDeps,
  unit: Unit,
  signal: AbortSignal,
  context: { states: Map<string, UnitState>; owner: ReceiptRun['plan'] },
): Promise<void> {
  const name = unitName(unit);
  context.states.set(name, 'running');
  const append = deps.appendReceipt;
  const run: ReceiptRun = {
    ...input.run,
    listGrowthApproved: input.env.SHRINK_ONLY_GROWTH_APPROVED === 'true',
    plan: context.owner,
  };
  const start = startReceipt(run, unit, new Date(deps.now()));
  try {
    append?.(start);
  } catch (error) {
    deps.log(`[run] ${name}: not started, its start could not reach the ledger: ${message(error)}`);
    context.states.set(name, 'failed');
    return;
  }
  deps.log(`[run] ${name}: started`);
  let state: UnitState = await deps.jobs.run(taskOf(input, unit), signal).then(
    (outcome) => {
      deps.log(`[run] ${name}: ${outcome.detail}`);
      return signal.aborted ? 'cancelled' : outcome.exitCode === 0 ? 'passed' : 'failed';
    },
    (error: unknown) => {
      deps.log(`[run] ${name}: the executor failed: ${message(error)}`);
      return signal.aborted ? 'cancelled' : 'failed';
    },
  );
  const end = endReceipt(start, deps.readResult(unit), state === 'passed', new Date(deps.now()));
  // A job whose own result does not stand fails, so nothing that needs it starts.
  if (end.problem && state === 'passed') {
    deps.log(`[run] ${name}: exited 0, but its result fails it: ${end.problem}`);
    state = 'failed';
  }
  if (append) {
    try {
      append(end.receipt);
    } catch (error) {
      // A receipt that cannot reach the ledger fails the job, as job.ts fails on it.
      deps.log(`[run] ${name}: its receipt could not reach the ledger: ${message(error)}`);
      context.states.set(name, 'failed');
      return;
    }
  }
  context.states.set(name, state);
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
  planned: Planned,
): Promise<Map<string, UnitState>> {
  const { units, owner } = planned;
  const states = new Map<string, UnitState>(units.map((unit) => [unitName(unit), 'waiting']));
  if (!owner) return states;
  const hold = heldUntil(owner.plan);
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
          startUnit(input, deps, unit, signal, { states, owner }).then(() => {
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

/**
 * A Check whose process failed after it wrote a pass is a failure: its result is set failed, and so
 * is its receipt, so neither the publisher, the queue nor a later push takes the pass.
 */
function settleCheck(input: RunCommitInput, deps: RunCommitDeps, exitCode: number | null): void {
  const unit: Unit = { job: 'check', shard: null };
  const written = deps.readResult(unit);
  if (exitCode === 0 || 'unreadable' in written || written.status !== 'passed') return;
  if (written.runUrl !== input.run.runUrl || written.attempt !== input.run.attempt) return;
  deps.log('[run] check: it wrote a pass, but did not pass; its result is set failed.');
  const failed: CiResult = { ...written, status: 'failed' };
  deps.writeResult(unit, failed);
  deps.appendReceipt?.(failed);
}

/**
 * Whether the run's Check passed: its process passed, and it left a completed passing result of
 * this run, attempt, event, commit and tree. A runner that posts `Check` by the exit code never
 * posts a pass that check.json does not hold.
 */
function checkPassed(input: RunCommitInput, deps: RunCommitDeps, exitCode: number | null): boolean {
  const written = deps.readResult({ job: 'check', shard: null });
  const { runUrl, attempt, event, commit, tree } = input.run;
  return (
    exitCode === 0 &&
    !('unreadable' in written) &&
    written.job === 'check' &&
    written.shard === null &&
    written.status === 'passed' &&
    written.completedAt !== null &&
    written.runUrl === runUrl &&
    written.attempt === attempt &&
    written.event === event &&
    written.commit === commit &&
    written.tree === tree
  );
}

/**
 * The run's dependencies with the ledger only when no job can write it: with an executor that does
 * not isolate its jobs, a run keeps no ledger and executes in full. scripts/ci/run-commit.ts refuses
 * such a run with a ledger before it starts (isolationProblem); this keeps the rule for every caller.
 */
function withLedgerBoundary(
  input: RunCommitInput,
  deps: RunCommitDeps,
): { input: RunCommitInput; deps: RunCommitDeps } {
  if (deps.jobs.isolatesJobs || (!input.env.CI_LEDGER && !deps.appendReceipt)) return { input, deps };
  deps.log(
    "[run] The executor's jobs could write the ledger, so this run keeps no ledger and reuses nothing.",
  );
  const env = { ...input.env };
  delete env.CI_LEDGER;
  return { input: { ...input, env }, deps: { ...deps, appendReceipt: undefined } };
}

/** Runs one commit's CI run: Plan, the plan's jobs through the executor, then Check. */
export async function runCommit(
  given: RunCommitInput,
  dependencies: RunCommitDeps,
  signal: AbortSignal,
): Promise<RunCommitOutcome> {
  const { input, deps } = withLedgerBoundary(given, dependencies);
  if (deps.publish && !(await deps.publish('start'))) {
    deps.log('[run] The queued Check could not be posted, so the run does not start.');
    return { exitCode: 2, units: [], scheduler: {} };
  }
  const planned = await planRun(input, deps, signal);
  if (planned === 'unstarted') return { exitCode: 2, units: [], scheduler: {} };
  const states = await runUnits(input, deps, signal, planned);
  const scheduler = schedulerReport(planned.passed, planned.units, states);
  // Check runs even after a cancellation, as on GitHub: a cancelled run reports a failed Check.
  const checkTask = taskOf(input, { job: 'check', shard: null });
  const checkOutcome = await deps.host.run(
    { ...checkTask, env: { ...checkTask.env, CI_NEEDS: JSON.stringify(scheduler) } },
    new AbortController().signal,
  );
  deps.log(`[run] check: ${checkOutcome.detail}`);
  let settled = true;
  try {
    settleCheck(input, deps, checkOutcome.exitCode);
  } catch (error) {
    // The publisher would post the pass Check wrote: it stays queued, never a success.
    deps.log(`[run] check: its failure could not be recorded, so no verdict is posted: ${message(error)}`);
    settled = false;
  }
  // A verdict that could not be posted leaves Check queued: 4, so the caller posts it again.
  const unposted = settled && deps.publish !== undefined && !(await deps.publish('finish'));
  if (unposted) deps.log('[run] The Check verdict could not be posted, so Check stays queued.');
  return {
    exitCode: unposted ? 4 : checkPassed(input, deps, checkOutcome.exitCode) ? 0 : 1,
    units: planned.units.map((unit) => ({ unit, state: states.get(unitName(unit)) ?? 'waiting' })),
    scheduler,
  };
}
