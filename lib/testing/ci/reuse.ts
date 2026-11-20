// Same-tree reuse (docs/technical/testing.md, "CI"): a CI runner's passed result stands for a new
// run of the same job on a byte-identical tree. Missing, incomplete or contradicted evidence runs
// the job.
import { isDeepStrictEqual } from 'node:util';
import { type CiEvent, type CiJob, REUSE_EVENTS } from './dag';
import type { CiResult, Ledger } from './results';

/** What a result must share with the new run to stand for it. */
export type ReuseKey = {
  job: CiJob;
  /** A browser or component shard's number, otherwise null. */
  shard: number | null;
  tree: string;
  /** The group ids the job runs; their order does not count. */
  groups: readonly string[];
  listGrowthApproved: boolean;
};

const sameGroups = (left: readonly string[], right: readonly string[]): boolean =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/**
 * The ledger Plan decides by. Plan appends its own `start` first and reads after, so a start of
 * another run appended meanwhile is in the ledger and withdraws a reuse; only Plan's exact start
 * receipt is left out. A failed append, an unreadable ledger or a ledger without that start is
 * unreadable, so nothing is reused.
 */
export function ledgerAfterStart(start: CiResult, append: () => void, read: () => Ledger): Ledger {
  try {
    append();
  } catch (error) {
    return {
      unreadable: `Plan's start could not be appended: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const ledger = read();
  if ('unreadable' in ledger) return ledger;
  const own = ledger.findLastIndex((receipt) => isDeepStrictEqual(receipt, start));
  return own === -1 ? { unreadable: "the ledger lacks Plan's own start" } : ledger.toSpliced(own, 1);
}

/**
 * The one reuse rule. Among the ledger's entries that `concern` the work, the newest `start`
 * decides: when every entry after it belongs to that start's run, the last of them is returned.
 * Any entry without a run, any entry of another run after that start, a missing start or an
 * unreadable ledger returns undefined, and the work runs.
 */
function lastOfNewestStart(
  ledger: Ledger,
  concerns: (receipt: CiResult) => boolean,
  isStart: (receipt: CiResult) => boolean,
): CiResult | undefined {
  if ('unreadable' in ledger) return undefined;
  const entries = ledger.filter(concerns);
  if (entries.some((receipt) => receipt.runUrl === null)) return undefined;
  const start = entries.findLastIndex(isStart);
  const runUrl = entries[start]?.runUrl;
  const since = entries.slice(start);
  return start !== -1 && since.every((receipt) => receipt.runUrl === runUrl) ? since.at(-1) : undefined;
}

/** A receipt that proves its own work: a CI runner's, completed, passed, and no reuse itself. */
const provesItself = (receipt: CiResult): boolean =>
  receipt.producer !== null &&
  receipt.status === 'passed' &&
  receipt.completedAt !== null &&
  receipt.reusedFrom === null;

/**
 * The run whose passed result stands for a new run of `key` on `event`, or undefined. The reuse
 * rule over the key's receipts on any event: the newest job start decides, and its run's own
 * result must come last, on a reuse event, with every group passed.
 */
export function reusableReceipt(ledger: Ledger, key: ReuseKey, event: CiEvent): string | undefined {
  if (!REUSE_EVENTS.includes(event) || !key.groups.length) return undefined;
  const last = lastOfNewestStart(
    ledger,
    (receipt) =>
      receipt.job === key.job &&
      receipt.shard === key.shard &&
      receipt.tree === key.tree &&
      receipt.listGrowthApproved === key.listGrowthApproved &&
      sameGroups(
        receipt.groups.map((group) => group.id),
        key.groups,
      ),
    (receipt) => receipt.status === 'running',
  );
  return last &&
    REUSE_EVENTS.includes(last.event) &&
    provesItself(last) &&
    last.groups.every((group) => group.outcome === 'passed')
    ? (last.runUrl ?? undefined)
    : undefined;
}

/**
 * The integration run whose `Check` passed this tree, from the ledger, or undefined. The reuse rule
 * over every receipt of the tree, on any event: the newest Plan start decides, and its run's own
 * passed integration `Check` must come last.
 */
function passedTreeInLedger(ledger: Ledger, tree: string): string | undefined {
  const last = lastOfNewestStart(
    ledger,
    (receipt) => receipt.tree === tree,
    (receipt) => receipt.job === 'plan' && receipt.status === 'running',
  );
  return last?.job === 'check' && last.event === 'integration' && provesItself(last)
    ? (last.runUrl ?? undefined)
    : undefined;
}

/**
 * The integration run that passed this tree, for a push to main, or undefined. A configured ledger
 * is the only source, so no other source can override its withdrawal of a pass; `onActions` asks
 * the merge queue only when the runner keeps no ledger (`ledger` undefined).
 */
export function passedTree(
  ledger: Ledger | undefined,
  tree: string,
  onActions: () => string | undefined,
): string | undefined {
  return ledger === undefined ? onActions() : passedTreeInLedger(ledger, tree);
}

/**
 * The jq filter over GitHub's list of merge-queue runs of ci.yml, newest first: the newest run of
 * this tree when it completed and succeeded, or nothing, so a later run, failed or still running,
 * withdraws an earlier pass as in the ledger. The merge queue squashes a PR onto main exactly as
 * its run tested it.
 */
export function passedTreeActionsFilter(tree: string): string {
  return `[.workflow_runs[] | select(.head_commit.tree_id == "${tree}")][0] | select(.status == "completed" and .conclusion == "success") | .html_url`;
}

/** The Actions API query that `passedTreeActionsFilter` reads. */
export function passedTreeActionsQuery(repository: string): string {
  return `repos/${repository}/actions/workflows/ci.yml/runs?event=merge_group&per_page=50`;
}
