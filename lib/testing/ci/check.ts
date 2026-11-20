// `Check`, the one required status (scripts/ci/job.ts check). It fails closed: a job the plan runs
// passes only with a complete passed result of this tree, and a job it skips only with the plan's
// reason for the skip.
import { z } from 'zod';
import { CI_JOBS, type CiEvent } from './dag';
import type { CiResult, CiShard, RunPlan } from './results';
import { jobShards, missingPlannerOutputs, plannedGroups } from './run-plan';

/** Each job's state as the scheduler reports it: ci.yml's `toJSON(needs)`. */
const schedulerSchema = z.partialRecord(
  z.enum(CI_JOBS),
  z.object({ result: z.enum(['success', 'failure', 'cancelled', 'skipped']) }),
);

/** The scheduler's report in CI_NEEDS; undefined when the runner gives none. Unreadable text throws. */
export function parseScheduler(json: string | undefined): z.infer<typeof schedulerSchema> | undefined {
  return json ? schedulerSchema.parse(JSON.parse(json)) : undefined;
}

/**
 * The run a job belongs to. With a producer, a CI runner's run, the plan must have one too: a plan
 * without one ran on a workstation or on a checkout that differs from its commit.
 */
export type CiRun = { tree: string; event: CiEvent; runUrl: string | null; producer: string | null };

/**
 * This run's plan, or why a job may not run by it: the plan must be of the run's tree, event and run,
 * completed and passed. Every job after Plan and `Check` take the plan only through this.
 */
export function runPlanOf(
  run: CiRun,
  plan: CiResult | { unreadable: string },
): { result: CiResult; plan: RunPlan } | { problem: string } {
  if ('unreadable' in plan) return { problem: plan.unreadable };
  if (plan.status !== 'passed' || !plan.plan || plan.completedAt === null)
    return { problem: `the plan ${plan.status === 'passed' ? 'is incomplete' : `is ${plan.status}`}` };
  if (plan.tree !== run.tree || plan.event !== run.event || plan.runUrl !== run.runUrl)
    return {
      problem: `it is the ${plan.event} plan of tree ${plan.tree} in run ${plan.runUrl}, not of this ${run.event} run ${run.runUrl} of ${run.tree}`,
    };
  if (run.producer !== null && plan.producer === null)
    return { problem: 'it ran outside CI or on a checkout that differs from its commit' };
  const missing = missingPlannerOutputs(plan.plan.outputs);
  if (missing.length) return { problem: `the plan holds no ${missing.join(', ')}` };
  return { result: plan, plan: plan.plan };
}

export type CheckInput = {
  /** The run this Check judges; every result must be of its tree, event and run, and have a producer when the run has one. */
  run: CiRun;
  /** The plan's result, or why it cannot be read. */
  plan: CiResult | { unreadable: string };
  /** Every other result the run's jobs wrote, or why one cannot be read. */
  results: readonly (CiResult | { unreadable: string })[];
  /** The scheduler's view of each job, when it reports one. */
  scheduler: z.infer<typeof schedulerSchema> | undefined;
};

/** The verdict and one line per job that says why. */
export function checkRun(input: CheckInput): { passed: boolean; lines: string[] } {
  const lines: string[] = [];
  let passed = true;
  const fail = (line: string): void => {
    passed = false;
    lines.push(`FAILED ${line}`);
  };
  // A scheduler that reports must report this run's Plan as a success: a rerun whose Plan failed
  // could otherwise read the passed plan an earlier attempt left.
  if (input.scheduler && input.scheduler.plan?.result !== 'success') {
    fail(`plan: the job ended ${input.scheduler.plan?.result ?? 'without a report'}`);
    return { passed, lines };
  }
  const ownPlan = runPlanOf(input.run, input.plan);
  if ('problem' in ownPlan) {
    fail(`plan: ${ownPlan.problem}`);
    return { passed, lines };
  }
  const plan = ownPlan.result;
  const { jobs, skips, outputs } = ownPlan.plan;
  for (const entry of input.results) if ('unreadable' in entry) fail(`result: ${entry.unreadable}`);
  const results = input.results.filter(
    (entry): entry is CiResult =>
      !('unreadable' in entry) &&
      entry.tree === plan.tree &&
      entry.event === plan.event &&
      entry.runUrl === plan.runUrl,
  );
  for (const entry of input.results)
    if (!('unreadable' in entry) && !results.includes(entry))
      fail(`${entry.job}: a result of another run (${entry.event}, tree ${entry.tree}, run ${entry.runUrl})`);
  for (const job of CI_JOBS.filter((name) => name !== 'plan' && name !== 'check')) {
    const scheduled = input.scheduler?.[job]?.result;
    if (scheduled === 'failure' || scheduled === 'cancelled') fail(`${job}: the job ended ${scheduled}`);
    const own = results.filter((result) => result.job === job);
    if (!jobs.includes(job)) {
      const reason = skips[job];
      if (reason === undefined) fail(`${job}: skipped without a reason in the plan`);
      else if (own.some((result) => result.status !== 'passed'))
        fail(`${job}: the plan skips it, but it ran and did not pass`);
      else lines.push(`${job}: skipped. ${reason}`);
      continue;
    }
    if (scheduled === 'skipped') fail(`${job}: the plan runs it, but the scheduler skipped it`);
    let sharded: CiShard[] | undefined;
    try {
      sharded = jobShards(job, ownPlan.plan);
    } catch (error) {
      fail(`${job}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (sharded && !sharded.length) fail(`${job}: the plan runs it without a shard`);
    const expected = sharded ?? [null];
    for (const shard of expected) {
      const label = shard === null ? job : `${job} ${shard.shard}`;
      const result = own.find((candidate) => candidate.shard === (shard?.shard ?? null));
      const missing = plannedGroups(job, outputs, shard?.groups).filter(
        (id) => !result?.groups.some((group) => group.id === id && group.outcome === 'passed'),
      );
      if (!result) fail(`${label}: no result`);
      else if (result.status === 'running' || result.completedAt === null)
        fail(`${label}: the result is incomplete`);
      else if (result.status !== 'passed') fail(`${label}: failed`);
      else if (missing.length) fail(`${label}: no passed result for ${missing.join(', ')}`);
      else if (input.run.producer !== null && result.producer === null)
        fail(`${label}: it ran outside CI or on a checkout that differs from its commit`);
      else lines.push(`${label}: passed`);
    }
  }
  if (plan.reusedFrom) lines.push(`The run reuses ${plan.reusedFrom}.`);
  return { passed, lines };
}
