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
  /**
   * The commit the run's Plan diffed against, resolved (null for a full run): every job's receipt
   * records its Plan's. The same tree on another base is another change.
   */
  base: string | null;
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
 * decides: every entry from it on must belong to that start's run, to the start's attempt or a
 * later one, and to an attempt no later than the last entry's, which is the accepted attempt; those
 * entries are returned. Any entry without a run or a readable attempt, any entry of another run,
 * an earlier attempt or a later attempt after that start, a missing start or an unreadable ledger
 * returns undefined, and the work runs.
 */
function sinceNewestStart(
  ledger: Ledger,
  concerns: (receipt: CiResult) => boolean,
  isStart: (receipt: CiResult) => boolean,
): CiResult[] | undefined {
  if ('unreadable' in ledger) return undefined;
  const entries = ledger.filter(concerns);
  if (entries.some((receipt) => receipt.runUrl === null)) return undefined;
  const start = entries.findLastIndex(isStart);
  if (start === -1) return undefined;
  const since = entries.slice(start);
  const runUrl = since[0]?.runUrl;
  const first = since[0]?.attempt;
  const accepted = since.at(-1)?.attempt;
  if (typeof first !== 'number' || typeof accepted !== 'number') return undefined;
  return since.every(
    (receipt) =>
      receipt.runUrl === runUrl &&
      typeof receipt.attempt === 'number' &&
      receipt.attempt >= first &&
      receipt.attempt <= accepted,
  )
    ? since
    : undefined;
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
  const last = sinceNewestStart(
    ledger,
    (receipt) =>
      receipt.job === key.job &&
      receipt.shard === key.shard &&
      receipt.tree === key.tree &&
      receipt.base === key.base &&
      receipt.listGrowthApproved === key.listGrowthApproved &&
      sameGroups(
        receipt.groups.map((group) => group.id),
        key.groups,
      ),
    (receipt) => receipt.status === 'running',
  )?.at(-1);
  return last &&
    REUSE_EVENTS.includes(last.event) &&
    provesItself(last) &&
    last.groups.every((group) => group.outcome === 'passed')
    ? (last.runUrl ?? undefined)
    : undefined;
}

/** A landing on main: its tree, the commit its plan diffs against, and the work that plan requires (`plannedWork`). */
export type Landing = { tree: string; base: string; work: readonly string[] };

const isPlanStart = (receipt: CiResult): boolean => receipt.job === 'plan' && receipt.status === 'running';

/**
 * The integration run whose `Check` passed this landing, from the ledger, or undefined. The reuse
 * rule over every receipt of the tree, on any event: the newest Plan start decides, and its run's
 * own passed integration `Check` must come last. Its own passed Plan must have diffed against the
 * landing's base and required exactly the landing's work: the same tree on another base, or under
 * another plan, is another change.
 */
function passedTreeInLedger(ledger: Ledger, landing: Landing): string | undefined {
  const since = sinceNewestStart(ledger, (receipt) => receipt.tree === landing.tree, isPlanStart);
  const last = since?.at(-1);
  // The run's one passed Plan: a rerun of failed jobs keeps it, and a second one (a rerun whose start
  // was lost, or an earlier attempt's late receipt) leaves the landing it passed unclear.
  const plans = since?.filter((receipt) => receipt.job === 'plan' && provesItself(receipt)) ?? [];
  const plan = plans.length === 1 ? plans[0] : undefined;
  return last?.job === 'check' &&
    last.event === 'integration' &&
    provesItself(last) &&
    // The Plan the Check verified the run by, not another Plan of the run.
    last.planStartedAt !== undefined &&
    plan?.startedAt === last.planStartedAt &&
    plan.base === landing.base &&
    plan.plan?.work !== undefined &&
    isDeepStrictEqual(plan.plan.work, landing.work)
    ? (last.runUrl ?? undefined)
    : undefined;
}

/**
 * The run whose passed Check last proved this tree on integration, main or full, or undefined: the
 * reuse rule over the tree's receipts, ending in a CI runner's finished passed Check. A main run's
 * Check that cites an integration pass counts. The merge queue asks it of main's tree before it
 * names a batch's first PR (lib/testing/ci/queue.ts).
 */
export function provenTree(ledger: Ledger, tree: string): string | undefined {
  const last = sinceNewestStart(ledger, (receipt) => receipt.tree === tree, isPlanStart)?.at(-1);
  return last?.job === 'check' &&
    last.event !== 'pr' &&
    last.status === 'passed' &&
    last.producer !== null &&
    last.completedAt !== null
    ? (last.runUrl ?? undefined)
    : undefined;
}

/**
 * The integration run that passed this landing, for a push to main, or undefined. A configured
 * ledger is the only source, so no other source can override its withdrawal of a pass; `onActions`
 * asks the merge queue only when the runner keeps no ledger (`ledger` undefined).
 */
export function passedTree(
  ledger: Ledger | undefined,
  landing: Landing,
  onActions: () => string | undefined,
): string | undefined {
  return ledger === undefined ? onActions() : passedTreeInLedger(ledger, landing);
}

/**
 * The jq filter over GitHub's list of merge-queue runs of ci.yml, newest first: the newest run of
 * this exact commit when it completed and succeeded, or nothing, so a later run, failed or still
 * running, withdraws an earlier pass as in the ledger. GitHub's merge queue moves main to the
 * commit its run tested, so the same commit is the same landing: the same parent and plan.
 */
export function passedTreeActionsFilter(commit: string): string {
  return `[.workflow_runs[] | select(.head_sha == "${commit}")][0] | select(.status == "completed" and .conclusion == "success") | .html_url`;
}

/** The Actions API query that `passedTreeActionsFilter` reads. */
export function passedTreeActionsQuery(repository: string): string {
  return `repos/${repository}/actions/workflows/ci.yml/runs?event=merge_group&per_page=50`;
}
