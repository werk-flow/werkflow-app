// `Check`, the one required status (scripts/ci/job.ts check). It fails closed: a job the plan runs
// passes only with a complete passed result of this tree, and a job it skips only with the plan's
// reason for the skip.
import { z } from 'zod';
import { CI_JOBS } from './dag';
import type { CiResult } from './results';

/** Each job's state as the scheduler reports it: ci.yml's `toJSON(needs)`. */
const schedulerSchema = z.partialRecord(
  z.enum(CI_JOBS),
  z.object({ result: z.enum(['success', 'failure', 'cancelled', 'skipped']) }),
);

/** The scheduler's report in CI_NEEDS; undefined when the runner gives none. Unreadable text throws. */
export function parseScheduler(json: string | undefined): z.infer<typeof schedulerSchema> | undefined {
  return json ? schedulerSchema.parse(JSON.parse(json)) : undefined;
}

export type CheckInput = {
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
  const plan = input.plan;
  if ('unreadable' in plan) {
    fail(`plan: ${plan.unreadable}`);
    return { passed, lines };
  }
  if (plan.status !== 'passed' || !plan.plan) {
    fail(`plan: the plan ${plan.status === 'passed' ? 'holds no run plan' : `is ${plan.status}`}`);
    return { passed, lines };
  }
  const { jobs, skips, shards } = plan.plan;
  for (const entry of input.results) if ('unreadable' in entry) fail(`result: ${entry.unreadable}`);
  const results = input.results.filter((entry): entry is CiResult => !('unreadable' in entry));
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
    if (job === 'browser' && !shards.length) fail('browser: the plan runs it without a shard');
    const expected = job === 'browser' ? shards.map((shard) => shard.shard) : [null];
    for (const shard of expected) {
      const label = shard === null ? job : `${job} ${shard}`;
      const result = own.find((candidate) => candidate.shard === shard);
      if (!result) fail(`${label}: no result`);
      else if (result.tree !== plan.tree)
        fail(`${label}: the result is of tree ${result.tree}, not ${plan.tree}`);
      else if (result.status === 'running' || result.completedAt === null)
        fail(`${label}: the result is incomplete`);
      else if (result.status !== 'passed') fail(`${label}: failed`);
      else lines.push(`${label}: passed`);
    }
  }
  if (plan.reusedFrom) lines.push(`The run reuses ${plan.reusedFrom}.`);
  return { passed, lines };
}
