// What CI costs per merged pull request (scripts/ci/cost.ts), from a runner's ledger or its results
// folders: job-minutes, machine starts, setup share, reuse rate and ready-to-merge time. It reads
// synthetic CI metadata only: run addresses, trees, PR numbers, groups and times.
import { z } from 'zod';
import type { CiJob } from './dag';
import {
  type CiResult,
  type FailureClass,
  failureClassSchema,
  type JobCost,
  positiveIntegerSchema,
} from './results';
import { jobShards } from './run-plan';

/** Steps inside a job body that set the job up rather than prove a gate: a browser shard's build and server. */
const SETUP_STEPS: readonly string[] = ['step:server'];

/** The cost of `result` at `completedAt` (null while it runs). `runnerStartedAt` adds the runner's setup. */
export function jobCost(
  result: CiResult,
  input: { machineStart: boolean; runnerStartedAt: string | null; completedAt: string | null },
): JobCost {
  // A runner clock ahead of the job's adds no setup and takes no wall time away.
  const bodyStarted = Date.parse(result.startedAt);
  const began = Math.min(Date.parse(input.runnerStartedAt ?? result.startedAt), bodyStarted);
  const beforeBody = bodyStarted - began;
  const inBody = result.groups
    .filter((group) => SETUP_STEPS.includes(group.id))
    .reduce((sum, group) => sum + group.durationMs, 0);
  return {
    machineStart: input.machineStart,
    runnerStartedAt: input.runnerStartedAt,
    setupMs: beforeBody + inBody,
    wallMs: input.completedAt === null ? null : Math.max(0, Date.parse(input.completedAt) - began),
  };
}

/** GitHub's merge-queue branch: `…/gh-readonly-queue/<base>/pr-<n>-<sha>`. */
const QUEUE_REF = /\/pr-(\d+)-[0-9a-f]{40}$/;

/**
 * The pull requests in CI_PRS: numbers separated by commas, or GitHub's merge-queue ref. Empty for
 * an empty value; a value of neither form is unreadable.
 */
export function pullRequestsOf(value: string | undefined): number[] | { unreadable: string } {
  if (!value) return [];
  const queued = QUEUE_REF.exec(value)?.[1];
  const numbers = z
    .array(positiveIntegerSchema)
    .safeParse(queued ? [Number(queued)] : /^\d+(,\d+)*$/.test(value) ? value.split(',').map(Number) : []);
  return numbers.success && numbers.data.length
    ? [...new Set(numbers.data)]
    : { unreadable: `CI_PRS "${value}" is neither PR numbers nor a merge-queue ref` };
}

/** The runner's measurement inputs to a job (scripts/ci/job.ts names them), and a warning for each it could not read. */
export function measurementInputs(environment: Readonly<Record<string, string | undefined>>): {
  prs: number[];
  attempt: number;
  firstAttemptClass: FailureClass | null;
  runnerStartedAt: string | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const prs = pullRequestsOf(environment.CI_PRS);
  if ('unreadable' in prs) warnings.push(prs.unreadable);
  const attempt = positiveIntegerSchema.safeParse(Number(environment.CI_RUN_ATTEMPT || '1'));
  if (!attempt.success) warnings.push(`CI_RUN_ATTEMPT "${environment.CI_RUN_ATTEMPT}" is no attempt number`);
  const failureClass = failureClassSchema.safeParse(environment.CI_FIRST_ATTEMPT_CLASS);
  if (environment.CI_FIRST_ATTEMPT_CLASS && !failureClass.success)
    warnings.push(`CI_FIRST_ATTEMPT_CLASS "${environment.CI_FIRST_ATTEMPT_CLASS}" is no failure class`);
  const startedAt = z.string().datetime().safeParse(environment.CI_JOB_STARTED_AT);
  if (environment.CI_JOB_STARTED_AT && !startedAt.success)
    warnings.push(`CI_JOB_STARTED_AT "${environment.CI_JOB_STARTED_AT}" is no ISO time`);
  return {
    prs: 'unreadable' in prs ? [] : prs,
    attempt: attempt.success ? attempt.data : 1,
    firstAttemptClass: failureClass.success ? failureClass.data : null,
    runnerStartedAt: startedAt.success ? startedAt.data : null,
    warnings,
  };
}

/** One job process: the newest receipt of one start of a job or shard. */
type JobProcess = CiResult;
type UnitKey = `${CiJob} ${number | 'one'}`;
const unitKey = (job: CiJob, shard: number | null): UnitKey => `${job} ${shard ?? 'one'}`;
const isWork = (job: CiJob): boolean => job !== 'plan' && job !== 'check';

/**
 * The job processes in `receipts`, in the order each first appears. A process is one start of a
 * job or shard in a run, named by its start time: a ledger holds its start and its end, a results
 * folder its newest receipt, and the same receipt may come from both. Its completed receipt wins;
 * one left `running` was cancelled.
 */
function jobProcesses(receipts: readonly CiResult[]): JobProcess[] {
  const processes = new Map<string, JobProcess>();
  for (const receipt of receipts) {
    const key = `${receipt.runUrl} ${unitKey(receipt.job, receipt.shard)} ${receipt.startedAt}`;
    const known = processes.get(key);
    if (known && known.status !== 'running') continue;
    processes.set(key, receipt);
  }
  return [...processes.values()];
}

type Tally = {
  runs: number;
  jobMs: number;
  machineStarts: number;
  setupMs: number;
  /** Jobs and shards a passed result of another run stood for. */
  reuseHits: number;
  /** Job processes between Plan and Check, a rerun's included. */
  executed: number;
};
const emptyTally = (): Tally => ({
  runs: 0,
  jobMs: 0,
  machineStarts: 0,
  setupMs: 0,
  reuseHits: 0,
  executed: 0,
});

type RunCost = Tally & {
  runUrl: string;
  event: CiResult['event'];
  tree: string;
  prs: number[];
  /** When the run's first Plan started, or null without a Plan receipt. */
  plannedAt: number | null;
  /** When the run's Check passed, or null. */
  passedAt: number | null;
  /** The jobs and shards between Plan and Check that ran, each once. */
  units: number;
  reusedFrom: string | null;
  cancelled: number;
  neverStarted: number;
  firstAttemptFailures: (FailureClass | 'unclassified')[];
  unselectedFailures: string[];
};

/** The jobs and shards the plan runs, or an empty list when its shards cannot be read. */
function plannedUnits(plan: CiResult['plan']): UnitKey[] {
  if (!plan) return [];
  return plan.jobs.flatMap((job) => {
    try {
      const shards = jobShards(job, plan);
      return shards ? shards.map((entry) => unitKey(job, entry.shard)) : [unitKey(job, null)];
    } catch {
      return [];
    }
  });
}

/** A process's job time; a cancelled one counts up to its attempt's last receipt, an upper bound. */
function processMs(entry: JobProcess, attemptEnd: number): number {
  const recorded = entry.cost?.wallMs;
  if (typeof recorded === 'number') return recorded;
  const began = Date.parse(entry.cost?.runnerStartedAt ?? entry.startedAt);
  const ended = entry.completedAt === null ? attemptEnd : Date.parse(entry.completedAt);
  return Math.max(0, ended - began);
}

/**
 * The failure class of each job's failed first attempt; a later attempt of the job names it. A
 * failed Check only follows a failed job, so it counts none of its own.
 */
function firstAttemptFailures(processes: readonly JobProcess[]): RunCost['firstAttemptFailures'] {
  return processes
    .filter((entry) => entry.job !== 'check' && entry.status === 'failed' && (entry.attempt ?? 1) === 1)
    .map((failed) => {
      const named = processes.find(
        (later) =>
          later.job === failed.job &&
          later.shard === failed.shard &&
          (later.attempt ?? 1) > 1 &&
          later.firstAttemptClass,
      );
      return named?.firstAttemptClass ?? 'unclassified';
    });
}

function runCost(runUrl: string, processes: readonly JobProcess[]): RunCost {
  const attemptEnd = (attempt: number): number =>
    Math.max(
      ...processes
        .filter((entry) => (entry.attempt ?? 1) === attempt)
        .map((entry) => Date.parse(entry.completedAt ?? entry.startedAt)),
    );
  const work = processes.filter((entry) => isWork(entry.job));
  const check = processes.findLast((entry) => entry.job === 'check');
  const plans = processes.filter((entry) => entry.job === 'plan');
  const plan = plans.at(-1);
  const started = new Set(processes.map((entry) => unitKey(entry.job, entry.shard)));
  const first = processes[0];
  return {
    runUrl,
    event: plan?.event ?? first?.event ?? 'pr',
    tree: plan?.tree ?? first?.tree ?? '',
    prs: processes.find((entry) => entry.prs !== undefined)?.prs ?? [],
    plannedAt: plans[0] ? Date.parse(plans[0].startedAt) : null,
    passedAt: check?.status === 'passed' && check.completedAt ? Date.parse(check.completedAt) : null,
    reusedFrom: plan?.reusedFrom ?? null,
    runs: 1,
    jobMs: processes.reduce((sum, entry) => sum + processMs(entry, attemptEnd(entry.attempt ?? 1)), 0),
    machineStarts: processes.filter((entry) => entry.cost?.machineStart ?? true).length,
    setupMs: processes.reduce((sum, entry) => sum + (entry.cost?.setupMs ?? 0), 0),
    reuseHits: plan?.plan?.reused?.length ?? 0,
    executed: work.length,
    units: new Set(work.map((entry) => unitKey(entry.job, entry.shard))).size,
    cancelled: processes.filter((entry) => entry.status === 'running').length,
    neverStarted: plannedUnits(plan?.plan).filter((unit) => !started.has(unit)).length,
    firstAttemptFailures: firstAttemptFailures(processes),
    unselectedFailures: [...new Set(processes.flatMap((entry) => entry.unselectedFailures ?? []))],
  };
}

function add(tally: Tally, run: Tally, share: number): void {
  tally.runs += 1;
  tally.jobMs += run.jobMs * share;
  tally.machineStarts += run.machineStarts * share;
  tally.setupMs += run.setupMs * share;
  tally.reuseHits += run.reuseHits * share;
  tally.executed += run.executed * share;
}

type MergedPr = Tally & { pr: number; readyToMergeMs: number | null };
export type CostSummary = {
  merged: MergedPr[];
  unmerged: Tally;
  full: Tally;
  other: Tally;
  all: Tally;
  cancelled: number;
  neverStarted: number;
  firstAttemptFailures: Partial<Record<FailureClass | 'unclassified', number>>;
  unselectedFailures: string[];
  /** Receipts that name no run: a workstation's, never CI's. */
  withoutRun: number;
};

/**
 * The integration run a push to main landed: the run it reused, or else the newest integration run
 * of its tree whose Check passed before the push's Plan.
 */
function landedBy(push: RunCost, runs: readonly RunCost[]): RunCost | undefined {
  if (push.reusedFrom) return runs.find((run) => run.runUrl === push.reusedFrom);
  const before = push.plannedAt ?? -Infinity;
  return runs
    .filter(
      (run) => run.event === 'integration' && run.tree === push.tree && (run.passedAt ?? Infinity) <= before,
    )
    .toSorted((left, right) => (left.passedAt ?? 0) - (right.passedAt ?? 0))
    .at(-1);
}

/**
 * Sums `receipts` per merged pull request. A PR merged when a push to main landed the tree of a
 * passed integration run that served it. A run's cost splits evenly across the PRs it served, and a
 * push's across its integration run's. A push that reused a tree counts the jobs and shards that run executed
 * as hits, or one when the input lacks that run. Ready to merge: the PR's first integration Plan to
 * the push's Plan.
 */
export function summarizeCost(receipts: readonly CiResult[]): CostSummary {
  const byRun = new Map<string, JobProcess[]>();
  for (const entry of jobProcesses(receipts))
    if (entry.runUrl !== null) byRun.set(entry.runUrl, [...(byRun.get(entry.runUrl) ?? []), entry]);
  const runs = [...byRun].map(([runUrl, processes]) => runCost(runUrl, processes));
  const landedPrs = new Map<RunCost, number[]>();
  const mergedBy = new Map<number, RunCost>();
  for (const push of runs.filter((run) => run.event === 'main')) {
    const landed = landedBy(push, runs);
    if (push.reusedFrom) push.reuseHits += landed ? Math.max(landed.units, 1) : 1;
    if (!landed?.prs.length) continue;
    landedPrs.set(push, landed.prs);
    for (const pr of landed.prs) if (!mergedBy.has(pr)) mergedBy.set(pr, push);
  }
  const perPr = new Map<number, Tally>([...mergedBy.keys()].map((pr) => [pr, emptyTally()]));
  const summary: CostSummary = {
    merged: [],
    unmerged: emptyTally(),
    full: emptyTally(),
    other: emptyTally(),
    all: emptyTally(),
    cancelled: 0,
    neverStarted: 0,
    firstAttemptFailures: {},
    unselectedFailures: [],
    withoutRun: receipts.filter((receipt) => receipt.runUrl === null).length,
  };
  for (const run of runs) {
    add(summary.all, run, 1);
    summary.cancelled += run.cancelled;
    summary.neverStarted += run.neverStarted;
    for (const failure of run.firstAttemptFailures)
      summary.firstAttemptFailures[failure] = (summary.firstAttemptFailures[failure] ?? 0) + 1;
    summary.unselectedFailures.push(...run.unselectedFailures);
    const prs = landedPrs.get(run) ?? run.prs;
    if (run.event === 'full') add(summary.full, run, 1);
    else if (!prs.length) add(summary.other, run, 1);
    if (run.event === 'full' || !prs.length) continue;
    for (const pr of prs) {
      const tally = perPr.get(pr);
      if (tally) add(tally, run, 1 / prs.length);
    }
    const unmerged = prs.filter((pr) => !perPr.has(pr)).length;
    if (unmerged) add(summary.unmerged, run, unmerged / prs.length);
  }
  summary.merged = [...perPr].map(([pr, tally]) => {
    const push = mergedBy.get(pr)?.plannedAt ?? null;
    const ready = runs.flatMap((run) =>
      run.event === 'integration' && run.prs.includes(pr) && run.plannedAt !== null ? [run.plannedAt] : [],
    );
    return {
      pr,
      ...tally,
      readyToMergeMs: push !== null && ready.length ? push - Math.min(...ready) : null,
    };
  });
  return summary;
}

const minutes = (ms: number): string => (ms / 60_000).toFixed(1);
const share = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((100 * part) / whole)} %` : '—';

function row(label: string, tally: Tally, ready = ''): string {
  return [
    label.padEnd(14),
    String(tally.runs).padStart(5),
    minutes(tally.jobMs).padStart(9),
    tally.machineStarts.toFixed(1).padStart(15),
    share(tally.setupMs, tally.jobMs).padStart(12),
    share(tally.reuseHits, tally.reuseHits + tally.executed).padStart(11),
    ready.padStart(15),
  ].join('');
}

/** The summary as a table and its notes. */
export function formatCost(summary: CostSummary): string {
  const failures = Object.entries(summary.firstAttemptFailures)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
  return [
    `CI cost per merged pull request: ${summary.merged.length} merged, ${summary.all.runs} runs.`,
    `${'PR'.padEnd(14)}${'Runs'.padStart(5)}${'Job-min'.padStart(9)}${'Machine starts'.padStart(15)}${'Setup share'.padStart(12)}${'Reuse rate'.padStart(11)}${'Ready to merge'.padStart(15)}`,
    ...summary.merged.map((entry) =>
      row(
        `#${entry.pr}`,
        entry,
        entry.readyToMergeMs === null ? '—' : `${minutes(entry.readyToMergeMs)} min`,
      ),
    ),
    row('Unmerged PRs', summary.unmerged),
    row('Full runs', summary.full),
    row('Other runs', summary.other),
    row('All runs', summary.all),
    `Cancelled jobs: ${summary.cancelled} (counted to their attempt's last receipt, an upper bound). Never started: ${summary.neverStarted}.`,
    `First-attempt failures: ${failures || 'none'}.`,
    `Failed groups of full runs that no plan selected: ${summary.unselectedFailures.length ? summary.unselectedFailures.join(', ') : 'none'}.`,
    `Receipts without a run, left out: ${summary.withoutRun}.`,
  ].join('\n');
}
