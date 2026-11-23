// How long a run may take and is expected to take, for the machine runner's ceiling and admission.
import { CI_DAG, CI_JOBS } from './dag';
import type { RunPlan } from './results';
import { jobShards } from './run-plan';

/** A job's staging and handoff beyond its own timeout, for the run's ceiling. */
export const STAGE_MS = 20 * 60_000;

/** The `p`th percentile of `values`, by nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  const value = sorted[rank - 1];
  if (value === undefined) throw new Error('No value to take a percentile of.');
  return value;
}

/** The longest a run of `plan` may take: each unit's timeout and its staging; before Plan, Plan's. */
export function ceilingMs(plan: RunPlan | null): number {
  if (plan === null) return CI_DAG.plan.timeoutMinutes * 60_000 + STAGE_MS;
  return CI_JOBS.filter((job) => job === 'plan' || plan.jobs.includes(job)).reduce(
    (sum, job) =>
      sum + (jobShards(job, plan)?.length ?? 1) * (CI_DAG[job].timeoutMinutes * 60_000 + STAGE_MS),
    0,
  );
}
