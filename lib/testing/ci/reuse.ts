// Same-tree reuse (docs/technical/testing.md, "CI"): a CI runner's passed result stands for a new
// run of the same job on a byte-identical tree. Missing, incomplete or contradicted evidence runs
// the job.
import { type CiEvent, type CiJob, REUSE_EVENTS } from './dag';
import type { CiResult } from './results';

/** What a result must share with the new run to stand for it. */
export type ReuseKey = {
  job: CiJob;
  tree: string;
  /** The group ids the job runs; their order does not count. */
  groups: readonly string[];
  listGrowthApproved: boolean;
};

const sameGroups = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/** Where a receipt points: its run, or its place in the ledger. */
const citation = (receipt: CiResult, index: number): string =>
  receipt.runUrl ?? `ledger receipt ${index + 1}`;

/**
 * The passed receipt that stands for a new run of `key` on `event`, or undefined. Only the newest
 * receipt for the key counts, on any event, so a later failure withdraws an earlier pass. It counts
 * when a CI runner produced it on a reuse event, it completed, it ran exactly the key's groups and
 * every group passed.
 */
export function reusableReceipt(
  receipts: readonly CiResult[],
  key: ReuseKey,
  event: CiEvent,
): string | undefined {
  if (!REUSE_EVENTS.includes(event) || !key.groups.length) return undefined;
  const index = receipts.findLastIndex(
    (receipt) =>
      receipt.job === key.job &&
      receipt.tree === key.tree &&
      receipt.listGrowthApproved === key.listGrowthApproved &&
      sameGroups(
        receipt.groups.map((group) => group.id),
        key.groups,
      ),
  );
  const receipt = receipts[index];
  if (
    !receipt ||
    !REUSE_EVENTS.includes(receipt.event) ||
    receipt.producer === null ||
    receipt.status !== 'passed' ||
    receipt.completedAt === null ||
    receipt.reusedFrom !== null ||
    !receipt.groups.every((group) => group.outcome === 'passed')
  )
    return undefined;
  return citation(receipt, index);
}

/**
 * The integration run whose `Check` passed this tree, from the ledger, or undefined. The newest
 * integration `Check` for the tree counts, so a later failure on it withdraws the pass.
 */
export function passedTreeInLedger(receipts: readonly CiResult[], tree: string): string | undefined {
  const index = receipts.findLastIndex(
    (receipt) => receipt.job === 'check' && receipt.event === 'integration' && receipt.tree === tree,
  );
  const receipt = receipts[index];
  return receipt &&
    receipt.producer !== null &&
    receipt.status === 'passed' &&
    receipt.completedAt !== null &&
    receipt.reusedFrom === null
    ? citation(receipt, index)
    : undefined;
}

/**
 * The jq filter over GitHub's list of green merge-queue runs of ci.yml that names the newest run of
 * this tree, or nothing. The merge queue squashes a PR onto main exactly as its run tested it.
 */
export function passedTreeActionsFilter(tree: string): string {
  return `[.workflow_runs[] | select(.head_commit.tree_id == "${tree}")][0].html_url // empty`;
}

/** The Actions API query that `passedTreeActionsFilter` reads. */
export function passedTreeActionsQuery(repository: string): string {
  return `repos/${repository}/actions/workflows/ci.yml/runs?event=merge_group&status=success&per_page=50`;
}
