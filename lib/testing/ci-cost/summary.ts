// What CI costs per merged pull request (scripts/ci-cost.ts), from a runner's ledger or its results
// folders: job-minutes, machine starts, setup share, reuse rate and ready-to-merge time. It reads
// synthetic CI metadata only: run addresses, trees, PR numbers, groups and times. It lives outside
// lib/testing/ci/, so a change to the report alone is no CI tooling change.
import type { CiJob } from '../ci/dag';
import type { CiResult, FailureClass } from '../ci/results';
import { jobShards } from '../ci/run-plan';

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
  /** The jobs and shards between Plan and Check the run covered, by running or reusing them, each once. */
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

/**
 * A process's job time. A cancelled one counts up to its attempt's last receipt; when it ended is
 * unknown. A runner clock ahead of the body counts from the body's start, as jobCost does.
 */
function processMs(entry: JobProcess, attemptEnd: number): number {
  const recorded = entry.cost?.wallMs;
  if (typeof recorded === 'number') return recorded;
  const bodyStarted = Date.parse(entry.startedAt);
  const began = Math.min(Date.parse(entry.cost?.runnerStartedAt ?? entry.startedAt), bodyStarted);
  const ended = entry.completedAt === null ? attemptEnd : Date.parse(entry.completedAt);
  return Math.max(0, ended - began);
}

/**
 * The failure class of each job or shard whose first attempt failed, once: a later attempt names it,
 * and a results folder may hold only that later attempt. A failed first-attempt Check counts only
 * when every other first-attempt job passed and none the plan held is missing: then it is a failure
 * of its own (for example a checkout that changed), not the echo of a failed, cancelled or unstarted job.
 */
function firstAttemptFailures(
  processes: readonly JobProcess[],
  missingUnits: number,
): RunCost['firstAttemptFailures'] {
  const failures = new Map<UnitKey, FailureClass | 'unclassified'>();
  for (const entry of processes) {
    if (entry.job === 'check') continue;
    const key = unitKey(entry.job, entry.shard);
    if ((entry.attempt ?? 1) > 1 && entry.firstAttemptClass) failures.set(key, entry.firstAttemptClass);
    else if ((entry.attempt ?? 1) === 1 && entry.status === 'failed' && !failures.has(key))
      failures.set(key, 'unclassified');
  }
  const firstAttempt = processes.filter((entry) => (entry.attempt ?? 1) === 1);
  const check = firstAttempt.find((entry) => entry.job === 'check');
  const othersPassed = firstAttempt.every((entry) => entry.job === 'check' || entry.status === 'passed');
  if (check?.status === 'failed' && othersPassed && !missingUnits && !failures.size)
    failures.set(unitKey('check', null), 'unclassified');
  return [...failures.values()];
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
    prs: [...new Set(processes.find((entry) => entry.prs !== undefined)?.prs ?? [])],
    plannedAt: plans[0] ? Date.parse(plans[0].startedAt) : null,
    passedAt: check?.status === 'passed' && check.completedAt ? Date.parse(check.completedAt) : null,
    reusedFrom: plan?.reusedFrom ?? null,
    runs: 1,
    jobMs: processes.reduce((sum, entry) => sum + processMs(entry, attemptEnd(entry.attempt ?? 1)), 0),
    machineStarts: processes.filter((entry) => entry.cost?.machineStart ?? true).length,
    setupMs: processes.reduce((sum, entry) => sum + (entry.cost?.setupMs ?? 0), 0),
    reuseHits: plan?.plan?.reused?.length ?? 0,
    executed: work.length,
    units: new Set([
      ...work.map((entry) => unitKey(entry.job, entry.shard)),
      ...(plan?.plan?.reused ?? []).map((entry) => unitKey(entry.job, entry.shard)),
    ]).size,
    cancelled: processes.filter((entry) => entry.status === 'running').length,
    neverStarted: plannedUnits(plan?.plan).filter((unit) => !started.has(unit)).length,
    firstAttemptFailures: firstAttemptFailures(
      processes,
      plannedUnits(plan?.plan).filter((unit) => !started.has(unit)).length,
    ),
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
    .toSorted(
      (left, right) =>
        (left.passedAt ?? 0) - (right.passedAt ?? 0) || left.runUrl.localeCompare(right.runUrl),
    )
    .at(-1);
}

/**
 * Sums `receipts` per merged pull request, the same in any input order. A PR merged when a push to
 * main landed the tree of a passed integration run that served it, or names it among the PRs it
 * landed. A run's cost splits evenly across the PRs it served, and a push's across those it landed. A push that reused a tree counts the jobs and shards that run executed
 * as hits, or one when the input lacks that run. Ready to merge: the PR's first integration Plan to
 * the push's Plan.
 */
export function summarizeCost(receipts: readonly CiResult[]): CostSummary {
  const byRun = new Map<string, JobProcess[]>();
  const inTimeOrder = jobProcesses(receipts).toSorted(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) ||
      (left.attempt ?? 1) - (right.attempt ?? 1) ||
      unitKey(left.job, left.shard).localeCompare(unitKey(right.job, right.shard)),
  );
  for (const entry of inTimeOrder)
    if (entry.runUrl !== null) byRun.set(entry.runUrl, [...(byRun.get(entry.runUrl) ?? []), entry]);
  const runs = [...byRun]
    .map(([runUrl, processes]) => runCost(runUrl, processes))
    .toSorted(
      (left, right) =>
        (left.plannedAt ?? Infinity) - (right.plannedAt ?? Infinity) ||
        left.runUrl.localeCompare(right.runUrl),
    );
  const landedPrs = new Map<RunCost, number[]>();
  const mergedBy = new Map<number, RunCost>();
  for (const push of runs.filter((run) => run.event === 'main')) {
    const landed = landedBy(push, runs);
    if (push.reusedFrom) push.reuseHits += landed ? Math.max(landed.units, 1) : 1;
    const prs = [...new Set([...push.prs, ...(landed?.prs ?? [])])];
    if (!prs.length) continue;
    landedPrs.set(push, prs);
    for (const pr of prs) if (!mergedBy.has(pr)) mergedBy.set(pr, push);
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
  summary.unselectedFailures.sort();
  summary.merged = [...perPr]
    .toSorted(([left], [right]) => left - right)
    .map(([pr, tally]) => {
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
    `Cancelled jobs: ${summary.cancelled} (counted to their attempt's last receipt; when they ended is unknown). Never started: ${summary.neverStarted}.`,
    `First-attempt failures: ${failures || 'none'}.`,
    `Failed groups of full runs that no plan selected: ${summary.unselectedFailures.length ? summary.unselectedFailures.join(', ') : 'none'}.`,
    `Receipts without a run, left out: ${summary.withoutRun}.`,
  ].join('\n');
}
