// What CI costs per merged pull request (scripts/ci-cost.ts), from a runner's ledger or its results
// folders: job-minutes, machine starts, setup share, reuse rate and ready-to-merge time, and beside
// them the Boat verification runs of the agents' checkouts (lib/testing/boat/boat-runs.ts). It reads
// synthetic metadata only: run addresses, trees, commits, PR numbers, groups, machine ids, times and
// dollars. It lives outside lib/testing/ci/, so a change to the report alone is no CI tooling change.
import { type BoatRun, boatRunDollars } from '../boat/boat-runs';
import type { CiJob } from '../ci/dag';
import type { CiResult, FailureClass } from '../ci/results';
import { jobShards } from '../ci/run-plan';

/** One job process: the newest receipt of one start of a job or shard. */
type JobProcess = CiResult;
type UnitKey = `${CiJob} ${number | 'one'}`;
const unitKey = (job: CiJob, shard: number | null): UnitKey => `${job} ${shard ?? 'one'}`;
const isWork = (job: CiJob): boolean => job !== 'plan' && job !== 'check';
/** A process's attempt: a receipt written before measurement holds none and was a first attempt; null is unknown. */
const attemptOf = (entry: JobProcess): number | null => (entry.attempt === undefined ? 1 : entry.attempt);

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
  /** A full run's selection misses as its final Check recorded them, or undefined when it recorded none. */
  unselectedFailures: string[] | undefined;
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
 * when every other first-attempt job passed and every job the plan held started in the first attempt: then it is a failure
 * of its own (for example a checkout that changed), not the echo of a failed, cancelled or unstarted job.
 */
function firstAttemptFailures(
  processes: readonly JobProcess[],
  planned: readonly UnitKey[],
): RunCost['firstAttemptFailures'] {
  const failures = new Map<UnitKey, FailureClass | 'unclassified'>();
  for (const entry of processes) {
    if (entry.job === 'check') continue;
    const key = unitKey(entry.job, entry.shard);
    const attempt = attemptOf(entry);
    if (attempt !== null && attempt > 1 && entry.firstAttemptClass)
      failures.set(key, entry.firstAttemptClass);
    else if (attempt === 1 && entry.status === 'failed' && !failures.has(key))
      failures.set(key, 'unclassified');
  }
  const firstAttempt = processes.filter((entry) => attemptOf(entry) === 1);
  const check = firstAttempt.find((entry) => entry.job === 'check');
  const othersPassed = firstAttempt.every((entry) => entry.job === 'check' || entry.status === 'passed');
  const firstStarted = new Set(firstAttempt.map((entry) => unitKey(entry.job, entry.shard)));
  const missing = planned.some((unit) => !firstStarted.has(unit));
  if (check?.status === 'failed' && othersPassed && !missing && !failures.size)
    failures.set(unitKey('check', null), 'unclassified');
  return [...failures.values()];
}

function runCost(runUrl: string, processes: readonly JobProcess[]): RunCost {
  const attemptEnd = (attempt: number | null): number =>
    Math.max(
      ...processes
        .filter((entry) => attemptOf(entry) === attempt)
        .map((entry) => Date.parse(entry.completedAt ?? entry.startedAt)),
    );
  const work = processes.filter((entry) => isWork(entry.job));
  const check = processes.findLast((entry) => entry.job === 'check');
  const plans = processes.filter((entry) => entry.job === 'plan');
  const plan = plans.at(-1);
  const started = new Set(processes.map((entry) => unitKey(entry.job, entry.shard)));
  const planned = plannedUnits(plan?.plan);
  // A rerun's Plan can reuse what the first attempt never started, so the first attempt answers to its own.
  const firstPlan = plans.find((entry) => attemptOf(entry) === 1) ?? plan;
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
    jobMs: processes.reduce((sum, entry) => sum + processMs(entry, attemptEnd(attemptOf(entry))), 0),
    machineStarts: processes.filter((entry) => entry.cost?.machineStart ?? true).length,
    setupMs: processes.reduce((sum, entry) => sum + (entry.cost?.setupMs ?? 0), 0),
    reuseHits: plan?.plan?.reused?.length ?? 0,
    executed: work.length,
    units: new Set([
      ...work.map((entry) => unitKey(entry.job, entry.shard)),
      ...(plan?.plan?.reused ?? []).map((entry) => unitKey(entry.job, entry.shard)),
    ]).size,
    cancelled: processes.filter((entry) => entry.status === 'running').length,
    neverStarted: planned.filter((unit) => !started.has(unit)).length,
    firstAttemptFailures: firstAttemptFailures(processes, plannedUnits(firstPlan?.plan)),
    unselectedFailures: check?.unselectedFailures && [...new Set(check.unselectedFailures)],
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
  /** The full runs' selection misses, or undefined when a full run's final Check recorded none: unknown. */
  unselectedFailures: string[] | undefined;
  /** Receipts that name no run: a workstation's, never CI's. */
  withoutRun: number;
  /** The Boat verification runs, when the input holds their records. */
  boat?: BoatSummary;
};

type BoatTally = {
  runs: number;
  /** From the machine's start to the run's record, upload and download included. */
  wallMs: number;
  dollars: number;
  /** Runs Boat gave no usage for: their dollars are missing from `dollars`. */
  withoutUsage: number;
};
const emptyBoat = (): BoatTally => ({ runs: 0, wallMs: 0, dollars: 0, withoutUsage: 0 });
type BoatSummary = {
  /** Each merged PR whose pull request run tested the commit a Boat run stood on. */
  merged: (BoatTally & { pr: number })[];
  /** Runs on a commit no merged PR's run tested: work in progress, unmerged or amended. */
  elsewhere: BoatTally;
  all: BoatTally;
};

function addBoat(tally: BoatTally, run: BoatRun, dollars: number | null, share: number): void {
  tally.runs += share;
  tally.wallMs += (Date.parse(run.completedAt) - Date.parse(run.startedAt)) * share;
  if (dollars === null) tally.withoutUsage += share;
  else tally.dollars += dollars * share;
}

/**
 * The Boat runs per merged PR. A run counts to the PRs whose pull request run tested its commit,
 * split evenly, and the share of a PR that did not merge counts elsewhere.
 */
function summarizeBoat(
  runs: readonly BoatRun[],
  receipts: readonly CiResult[],
  merged: ReadonlySet<number>,
): BoatSummary {
  const prsOf = new Map<string, Set<number>>();
  for (const receipt of receipts)
    if (receipt.event === 'pr' && receipt.prs?.length)
      prsOf.set(receipt.commit, new Set([...(prsOf.get(receipt.commit) ?? []), ...receipt.prs]));
  const perPr = new Map<number, BoatTally>();
  const summary: BoatSummary = { merged: [], elsewhere: emptyBoat(), all: emptyBoat() };
  for (const { run, dollars } of boatRunDollars(runs)) {
    addBoat(summary.all, run, dollars, 1);
    const prs = [...(run.head ? (prsOf.get(run.head) ?? []) : [])];
    if (!prs.length) addBoat(summary.elsewhere, run, dollars, 1);
    for (const pr of prs) {
      const tally = merged.has(pr) ? (perPr.get(pr) ?? emptyBoat()) : summary.elsewhere;
      addBoat(tally, run, dollars, 1 / prs.length);
      if (merged.has(pr)) perPr.set(pr, tally);
    }
  }
  summary.merged = [...perPr]
    .toSorted(([left], [right]) => left - right)
    .map(([pr, tally]) => ({ pr, ...tally }));
  return summary;
}

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
export function summarizeCost(receipts: readonly CiResult[], boatRuns?: readonly BoatRun[]): CostSummary {
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
    if (run.event === 'full')
      summary.unselectedFailures =
        summary.unselectedFailures && run.unselectedFailures
          ? [...summary.unselectedFailures, ...run.unselectedFailures]
          : undefined;
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
  summary.unselectedFailures?.sort();
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
  if (boatRuns) summary.boat = summarizeBoat(boatRuns, receipts, new Set(mergedBy.keys()));
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

function boatRow(label: string, tally: BoatTally): string {
  const missing = tally.withoutUsage ? `  (${tally.withoutUsage.toFixed(1)} runs without Boat's usage)` : '';
  return `${label.padEnd(14)}${tally.runs.toFixed(1).padStart(6)}${minutes(tally.wallMs).padStart(10)}${`$${tally.dollars.toFixed(2)}`.padStart(9)}${missing}`;
}

/** The Boat runs beside CI, or why the summary has none. */
function boatLines(boat: BoatSummary | undefined): string[] {
  if (!boat) return ['Boat verification: no Boat run records given (--boat <boat-runs.jsonl>).'];
  return [
    'Boat verification beside CI (test:verify on Boat, the early warning before the queue):',
    `${'PR'.padEnd(14)}${'Runs'.padStart(6)}${'Wall-min'.padStart(10)}${'Dollars'.padStart(9)}`,
    ...boat.merged.map((entry) => boatRow(`#${entry.pr}`, entry)),
    boatRow('Elsewhere', boat.elsewhere),
    boatRow('All Boat runs', boat.all),
  ];
}

/** The summary as a table and its notes. */
export function formatCost(summary: CostSummary): string {
  const failures = Object.entries(summary.firstAttemptFailures)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(', ');
  const unselected =
    summary.unselectedFailures === undefined
      ? 'unknown: a full run did not measure them'
      : summary.unselectedFailures.join(', ') || 'none';
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
    `Failed groups of full runs that no plan selected: ${unselected}.`,
    `Receipts without a run, left out: ${summary.withoutRun}.`,
    ...boatLines(summary.boat),
  ].join('\n');
}
