// What a CI job measures about itself (scripts/ci/job.ts): its cost and the runner's measurement
// inputs. lib/testing/ci-cost/summary.ts sums them; no gate reads them.
import { z } from 'zod';
import {
  type CiResult,
  type FailureClass,
  failureClassSchema,
  type JobCost,
  positiveIntegerSchema,
} from './results';

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
  /** Null when CI_RUN_ATTEMPT cannot be read: unknown, never a first attempt. */
  attempt: number | null;
  firstAttemptClass: FailureClass | null;
  runnerStartedAt: string | null;
  /** False when CI_MACHINE_START is `false`: the job ran on the orchestrator's own host. */
  machineStart: boolean;
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
  const machineStart = environment.CI_MACHINE_START;
  if (machineStart && machineStart !== 'true' && machineStart !== 'false')
    warnings.push(`CI_MACHINE_START "${machineStart}" is neither true nor false`);
  return {
    prs: 'unreadable' in prs ? [] : prs,
    attempt: attempt.success ? attempt.data : null,
    firstAttemptClass: failureClass.success ? failureClass.data : null,
    runnerStartedAt: startedAt.success ? startedAt.data : null,
    machineStart: machineStart !== 'false',
    warnings,
  };
}
