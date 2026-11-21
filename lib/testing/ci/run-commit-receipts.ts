// The receipts scripts/ci/run-commit.ts appends to the runner's ledger for the jobs it starts through
// an executor, which never see the ledger (lib/testing/ci/run-commit.ts). The start is the
// orchestrator's own, appended before the job begins, so a Plan of another run that reads the ledger
// meanwhile already sees the attempt (lib/testing/ci/reuse.ts). The end is the job's own result, but
// a pass counts only when the executor saw the job pass too.
import type { CiResult, PlanIdentity, RunPlan } from './results';
import { jobShards, plannedGroups } from './run-plan';

type Unit = { job: CiResult['job']; shard: number | null };

/** What the orchestrator knows of the run when a job starts: its Plan and the job's inputs. */
export type ReceiptRun = {
  event: CiResult['event'];
  commit: string;
  tree: string;
  runUrl: string;
  attempt: number;
  producer: string | null;
  /** The run's `approved: list growth`, as the job reads it (SHRINK_ONLY_GROWTH_APPROVED). */
  listGrowthApproved: boolean;
  plan: { result: CiResult; plan: RunPlan; identity: PlanIdentity };
};

/**
 * The job's start receipt as scripts/ci/job.ts writes it: running, its planned groups not run yet, and
 * the Plan it runs under. It carries the key the reuse rule compares, so it withdraws an earlier pass
 * of that work at once.
 */
export function startReceipt(run: ReceiptRun, unit: Unit, startedAt: Date): CiResult {
  const shardGroups = jobShards(unit.job, run.plan.plan)?.find((entry) => entry.shard === unit.shard)?.groups;
  return {
    version: 1,
    job: unit.job,
    shard: unit.shard,
    event: run.event,
    tree: run.tree,
    commit: run.commit,
    base: run.plan.result.base,
    status: 'running',
    groups: plannedGroups(unit.job, run.plan.plan.outputs, shardGroups).map((id) => ({
      id,
      outcome: 'not-run',
      durationMs: 0,
    })),
    planReason: run.plan.result.planReason,
    reusedFrom: null,
    listGrowthApproved: run.listGrowthApproved,
    producer: run.producer,
    runUrl: run.runUrl,
    startedAt: startedAt.toISOString(),
    completedAt: null,
    ...(run.plan.result.prs ? { prs: run.plan.result.prs } : {}),
    attempt: run.attempt,
    planIdentity: run.plan.identity,
  };
}

/**
 * The job's end receipt. Its own result counts only when it is of this run, attempt, commit, tree,
 * unit and Plan and started after the start receipt; a pass counts only when it completed and the
 * executor saw the job pass. Anything else ends the start receipt failed, so the attempt withdraws an
 * earlier pass and proves nothing. A failure it wrote is a problem even when the executor saw a pass.
 */
export function endReceipt(
  start: CiResult,
  written: CiResult | { unreadable: string },
  executorPassed: boolean,
  endedAt: Date,
): { receipt: CiResult; problem?: string } {
  const failed = (problem: string) => ({
    receipt: { ...start, status: 'failed' as const, completedAt: endedAt.toISOString() },
    problem,
  });
  if ('unreadable' in written) return failed(written.unreadable);
  const own =
    written.job === start.job &&
    written.shard === start.shard &&
    written.event === start.event &&
    written.commit === start.commit &&
    written.tree === start.tree &&
    written.runUrl === start.runUrl &&
    written.attempt === start.attempt &&
    (written.producer === null || written.producer === start.producer) &&
    JSON.stringify(written.planIdentity) === JSON.stringify(start.planIdentity) &&
    written.startedAt >= start.startedAt;
  if (!own) return failed('its result is not of this run, attempt and Plan');
  if (written.status === 'passed' && !executorPassed)
    return { ...failed('it wrote a pass, but did not pass'), receipt: { ...written, status: 'failed' } };
  if (written.status === 'running') return failed('it ended without a result');
  if (written.status === 'passed' && written.completedAt === null)
    return failed('it wrote a pass without completion');
  if (written.status === 'failed' && executorPassed)
    return { receipt: written, problem: 'it exited 0, but wrote a failure' };
  return { receipt: written };
}
