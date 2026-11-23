// The one result each CI job writes, and the runner's ledger of them (scripts/ci/job.ts).
// `Check` reads the results of its run; a later run reads the ledger to reuse a passed result.
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { INCIDENT_CLASSES } from '../runner/run-policy';
import { CI_EVENTS, CI_JOBS, type CiJob } from './dag';

const shardSchema = z.object({ shard: z.number().int().positive(), groups: z.string().min(1) });
export type CiShard = z.infer<typeof shardSchema>;

/** What the plan decided for the run; only the plan's own result carries it. */
const runPlanSchema = z.object({
  /** The jobs this run executes. */
  jobs: z.array(z.enum(CI_JOBS)),
  /** Why each other job does not run. `Check` passes a skipped job only with its reason here. */
  skips: z.partialRecord(z.enum(CI_JOBS), z.string().min(1)),
  /** The browser shards this run executes. */
  shards: z.array(shardSchema),
  /** The planner's outputs, `$GITHUB_OUTPUT` keys of scripts/ci-plan.ts with the run's changes. */
  outputs: z.record(z.string(), z.string()),
  /** Each job or shard that another run's passed result stands for, with that run. Absent on older plans. */
  reused: z
    .array(
      z.object({
        job: z.enum(CI_JOBS),
        shard: z.number().int().positive().nullable(),
        runUrl: z.string().min(1),
      }),
    )
    .optional(),
  /**
   * The work the run's event requires of the selection before reuse, as `job:group`, sorted
   * (`plannedWork` in lib/testing/ci/run-plan.ts). A push reuses a passed run of its tree only when
   * that run required the same work. Absent on older plans, which no push reuses.
   */
  work: z.array(z.string().min(1)).optional(),
});
export type RunPlan = z.infer<typeof runPlanSchema>;

/** A PR number or an attempt: a positive safe integer, so a measurement input that passes it parses as a receipt. */
export const positiveIntegerSchema = z.number().int().positive();

/**
 * The Plan a job ran under (`planIdentityOf` in lib/testing/ci/check.ts): its run, attempt, start,
 * base and a digest of its decision. A replanned attempt has another identity, a rerun of failed
 * jobs under the same Plan the same one.
 */
const planIdentitySchema = z.object({
  runUrl: z.string().min(1).nullable(),
  attempt: positiveIntegerSchema.nullable(),
  startedAt: z.string().datetime(),
  base: z.string().nullable(),
  /** SHA-256 of the Plan's decision (`plan`), keys sorted. */
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PlanIdentity = z.infer<typeof planIdentitySchema>;

/** The failure classes of docs/technical/testing.md, "Failures". `transient` is retired. */
export const failureClassSchema = z.enum(INCIDENT_CLASSES).exclude(['transient']);
export type FailureClass = z.infer<typeof failureClassSchema>;

/** What a job cost (lib/testing/ci/measurement.ts). The runner sets the inputs; the job never fails on them. */
const jobCostSchema = z.object({
  /** One per job process on a CI runner; none on a workstation. */
  machineStart: z.boolean(),
  /** When the runner began the job, before its checkout and setup (CI_JOB_STARTED_AT), or null. */
  runnerStartedAt: z.string().datetime().nullable(),
  /** The runner's setup before the job body, and a browser shard's build and server start. */
  setupMs: z.number().nonnegative(),
  /** From the runner's start of the job, or the body's when unknown, to its result; null while it runs. */
  wallMs: z.number().nonnegative().nullable(),
});
export type JobCost = z.infer<typeof jobCostSchema>;

const ciResultSchema = z.object({
  version: z.literal(1),
  job: z.enum(CI_JOBS),
  /** A browser or component shard's number, otherwise null. */
  shard: z.number().int().positive().nullable(),
  event: z.enum(CI_EVENTS),
  tree: z.string().regex(/^[0-9a-f]{40}$/),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  base: z.string().nullable(),
  /** `running` until the job ends; a result that stays `running` is incomplete. */
  status: z.enum(['running', 'passed', 'failed']),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      outcome: z.enum(['passed', 'failed', 'blocked', 'not-run']),
      durationMs: z.number().nonnegative(),
    }),
  ),
  /** The plan's reason: a full run's, or the selection by diff. */
  planReason: z.string(),
  /** The run whose result stands for this one, when the plan reused a passed tree. */
  reusedFrom: z.string().nullable(),
  /** The owner's `approved: list growth` (docs/technical/testing.md, "Grow a shrink-only list"). */
  listGrowthApproved: z.boolean(),
  /** The CI runner that produced the result, or null on a workstation, whose results never count. */
  producer: z.string().min(1).nullable(),
  /** The run's identity (CI_RUN_URL); a receipt that names no run is invalid. */
  runUrl: z.string().min(1).nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  plan: runPlanSchema.optional(),
  /**
   * Check's own: when the Plan it verified the run by started. A push reuses the run only by that
   * Plan's receipt in the ledger (lib/testing/ci/reuse.ts). Absent on older Checks, which no push reuses.
   */
  planStartedAt: z.string().datetime().optional(),
  /**
   * Every job's but Plan's and Check's: the Plan it ran under. Check passes a planned job only by a
   * result that names the run's current Plan, so an attempt that planned again never stands on an
   * earlier Plan's result. Absent on older results, which never pass Check.
   */
  planIdentity: planIdentitySchema.optional(),
  // Measurement (lib/testing/ci/measurement.ts, summed by scripts/ci-cost.ts). Optional: receipts written before it hold none, and no gate
  // or reuse decision reads them.
  /** The pull requests the run serves: a PR run's one, an integration batch's, a push's landed ones; none for a full run. */
  prs: z.array(positiveIntegerSchema).optional(),
  /** The run's attempt, 1 for the first; a rerun of its failed jobs counts up (CI_RUN_ATTEMPT). Null: unreadable. */
  attempt: positiveIntegerSchema.nullable().optional(),
  cost: jobCostSchema.optional(),
  /** On a rerun: the class the failed first attempt of this job was given (CI_FIRST_ATTEMPT_CLASS). */
  firstAttemptClass: failureClassSchema.nullable().optional(),
  /** A full run's failed groups that no diff plan of its trees selected: selection misses. A full run's Check records them from its runner's ledger (scripts/ci/job.ts). */
  unselectedFailures: z.array(z.string().min(1)).optional(),
});
export type CiResult = z.infer<typeof ciResultSchema>;

/** The file a job writes in the results directory: `<job>.json`, a shard's `<job>-<n>.json`. */
export function resultFileName(job: CiJob, shard: number | null): string {
  return shard === null ? `${job}.json` : `${job}-${shard}.json`;
}

/** The result a text holds, or undefined; no detail of a malformed text is kept. */
export function parseResult(text: string): CiResult | undefined {
  try {
    const parsed = ciResultSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The result in `path`, or why it cannot count. */
export function readResult(path: string): CiResult | { unreadable: string } {
  if (!existsSync(path)) return { unreadable: `${path} is missing` };
  try {
    const parsed = ciResultSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success
      ? parsed.data
      : { unreadable: `${path} is no valid result: ${parsed.error.message}` };
  } catch (error) {
    return {
      unreadable: `${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The runner's ledger as `readLedger` returns it. */
export type Ledger = readonly CiResult[] | { unreadable: string };

/**
 * Every receipt of the ledger, oldest first, or why none can count. One unreadable line makes the
 * whole ledger unreadable: it could hide a later failure of a passed result.
 */
export function readLedger(path: string): CiResult[] | { unreadable: string } {
  if (!existsSync(path)) return [];
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch (error) {
    return {
      unreadable: `${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const receipts: CiResult[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = ciResultSchema.safeParse(JSON.parse(line));
      if (!parsed.success) return { unreadable: `${path}:${index + 1} is no valid receipt` };
      receipts.push(parsed.data);
    } catch {
      return { unreadable: `${path}:${index + 1} is no JSON` };
    }
  }
  return receipts;
}
