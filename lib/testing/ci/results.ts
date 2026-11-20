// The one result each CI job writes, and the runner's ledger of them (scripts/ci/job.ts).
// `Check` reads the results of its run; a later run reads the ledger to reuse a passed result.
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
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
});
export type RunPlan = z.infer<typeof runPlanSchema>;

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
});
export type CiResult = z.infer<typeof ciResultSchema>;

/** The file a job writes in the results directory: `<job>.json`, a shard's `<job>-<n>.json`. */
export function resultFileName(job: CiJob, shard: number | null): string {
  return shard === null ? `${job}.json` : `${job}-${shard}.json`;
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
