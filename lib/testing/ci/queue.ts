// The batching merge queue (owner decision D2, werk-flow/werkflow-planning#509). One tick takes up
// to four queued pull requests in queue order, squashes them onto main one by one, runs the
// integration run once on the batch's tip, and lands the PRs through GitHub's own merge when it
// passed. A red batch bisects over its prefixes, so the failure names its PR, and the tested green
// prefix before it lands. scripts/ci/queue-adapter.ts holds git, GitHub and the runner; every
// decision lives here.
import { z } from 'zod';
import { contradiction, noVerdict, type Retry, retryOf, retrySchema, type Work, workOf } from './queue-retry';

/** The owner's batch size (D2). */
export const MAX_BATCH = 4;

/** An open pull request against main, as the queue reads it from GitHub. */
export type QueuedPull = {
  number: number;
  title: string;
  headSha: string;
  isDraft: boolean;
  /** When its thread asked GitHub to merge it (`gh pr merge --squash --auto`): its place in the queue. Null: not queued. */
  queuedAt: string | null;
  /**
   * The PR's own `Check` on its head, the fast tier: `SUCCESS`, `PENDING`, `FAILURE`, `ERROR`, or
   * `MISSING`. The commit status until the CI App exists, then only the App's newest check run.
   */
  check: string;
  /** GitHub's merge state: `DIRTY` conflicts with main; `BEHIND` lacks main while the ruleset requires an up-to-date branch. */
  mergeState: string;
  /** The owner's `approved: list growth` label. */
  listGrowthApproved: boolean;
};

/** One PR of the batch with the squash commit that puts it onto the batch so far. */
export type BatchEntry = { pull: QueuedPull; commit: string; tree: string };

/** A commit of main with its parents and tree. */
export type MainCommit = { commit: string; parents: readonly string[]; tree: string };

/**
 * An integration run's answer for one prefix of the batch. `inconclusive`: the run left no evidence
 * either way (a cancelled worker, a missing result, a job that died before its groups ran).
 */
export type Verdict = { kind: 'passed' | 'failed' | 'inconclusive'; runUrl: string; detail: string };

/**
 * The `Queue` success the queue posts on a PR head right before it merges it. The queue saves it
 * before it posts it, and clears it only once the mark was withdrawn, merged or not: GitHub reads a
 * head's checks for a merge whose test commit has none, so with strict off a success left on a
 * merged head would let the same head merge again onto a later main without a queue run.
 */
type PendingMark = { pull: number; head: string; runUrl: string; verdict: 'success' };

/**
 * What the queue keeps between ticks: a mark it may have left green, why it froze, if it did, and
 * the runs without a verdict later ticks retry, one per work.
 */
export type QueueState = { pending: PendingMark | null; frozen: string | null; retry?: Retry | undefined };

export const queueStateSchema = z
  .object({
    pending: z
      .object({
        pull: z.number().int().positive(),
        head: z.string().regex(/^[0-9a-f]{40}$/),
        runUrl: z.string().min(1),
        verdict: z.literal('success'),
      })
      .strict()
      .nullable(),
    frozen: z.string().min(1).nullable(),
    retry: retrySchema.optional(),
  })
  .strict();

const CLEAR: QueueState = { pending: null, frozen: null };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Everything the queue does outside its decisions. */
export type QueueAdapter = {
  main(): Promise<MainCommit>;
  /** Every open pull request against main, current. */
  pulls(): Promise<readonly QueuedPull[]>;
  /** The squash commit of `pull` onto `parent`, as GitHub's squash merge builds it, or undefined on a conflict. */
  squash(parent: string, pull: QueuedPull): Promise<{ commit: string; tree: string } | undefined>;
  /**
   * Why the migrations `entry` adds would land out of order on `parent`, a prefix of the batch: the
   * migration-order gate (lib/testing/local-stack/migration-order.ts) of its commit against
   * `parent`. Empty when they would not.
   */
  migrationProblems(parent: string, entry: BatchEntry): Promise<string[]>;
  /** Merges main into the PR's branch on GitHub, only while its head is still `pull.headSha`. Throws when it cannot. */
  updateBranch(pull: QueuedPull): Promise<void>;
  /** The integration run of `tip` (scripts/ci/job.ts through the runner) and its verdict. */
  integrationRun(run: { tip: BatchEntry; base: string; pulls: readonly QueuedPull[] }): Promise<Verdict>;
  /** Turns the PR's auto-merge off, so a green `Queue` alone never merges it. Throws when it cannot. */
  disableAutoMerge(pull: QueuedPull): Promise<void>;
  /**
   * Saves durably that main's run after this tick's landing is owed: the tick's base, the PRs it
   * may have landed once the next merge went through, and that merge's PR (`merging`). Called before
   * each merge is asked for, so a tick that dies after GitHub accepted it leaves the run to the next
   * tick, which asks GitHub about `merging` and starts the run before it touches the pending mark
   * (scripts/ci/queue.ts). Throws when it cannot; nothing merges then.
   */
  oweMainRun(followUp: { base: string; prs: readonly number[]; merging: number }): Promise<void>;
  /** Marks the head as passed by the queue and squash-merges it on GitHub, only at that head. */
  land(pull: QueuedPull, proof: Verdict): Promise<void>;
  /** The PR's merge commit when GitHub reports it merged, otherwise null. Throws when GitHub reports it merged without one. */
  mergeCommit(pull: number): Promise<string | null>;
  /** Marks the head as no longer passed, after its merge or one that did not happen, so no later merge takes the mark. Throws when it cannot. */
  withdraw(mark: PendingMark): Promise<void>;
  /** The state the last tick saved; a fresh queue's is clear. Throws when it cannot be read. */
  state(): Promise<QueueState>;
  /** Saves the state durably before it returns. */
  saveState(state: QueueState): Promise<void>;
  /** Whether the runner's ledger proves `tree` green: a passed Check of a CI runner is its newest run's last receipt. */
  proven(tree: string): Promise<boolean>;
  /** Tells the PR's thread that its batch failed on it, and takes it out of the queue. */
  reject(pull: QueuedPull, proof: Verdict): Promise<void>;
};

/**
 * `partial`: the landing stopped after some PRs of the tested prefix, or after a merge that moved
 * main to a commit the queue could not verify or read, so main may have moved. Under D2 a batch's
 * own main commits are not tested one by one; main's own run of that commit runs its jobs unless a
 * run passed its exact landing, and the next tick starts from that main. `retry`: a run without a
 * verdict, which the next tick retries once. `migration-order`: a PR whose migration would land
 * out of order after another PR of the batch waits for a later tick. `update-failed`: GitHub
 * refused to update a branch that is behind main; the next tick asks again.
 */
type StopKind =
  | 'idle'
  | 'superseded'
  | 'inconclusive'
  | 'retry'
  | 'stale-base'
  | 'landing-failed'
  | 'frozen'
  | 'partial'
  | 'migration-order'
  | 'update-failed';

/** What one tick did, for its log and the runner. */
export type QueueOutcome = {
  base: string;
  dryRun: boolean;
  batch: number[];
  /** Taken PRs left out because they conflict with main and the PRs before them. */
  conflicts: number[];
  /** Each integration run; a rerun that confirms a red full batch names the run it repeats. */
  runs: { prs: number[]; tree: string; verdict: Verdict; rerunOf?: string }[];
  /** The PR the failed batch names; in a dry run it is not told. */
  culprit: number | null;
  /** The PRs landed, in order; in a dry run the PRs it would land. */
  landing: number[];
  stops: { kind: StopKind; detail: string }[];
  /** The behind PR whose branch the tick updated with main, or null. */
  updated: number | null;
};

/** A tick that stopped on something a person has to look at: no verdict, a landing that broke, or a freeze. */
export function needsAttention(outcome: QueueOutcome): boolean {
  return outcome.stops.some(
    (stop) => stop.kind === 'inconclusive' || stop.kind === 'landing-failed' || stop.kind === 'frozen',
  );
}

/** Whether the PR asked to merge: ready, and auto-merge on. */
const asked = (pull: QueuedPull): boolean => !pull.isDraft && pull.queuedAt !== null;

/** Whether GitHub would merge the PR onto main as it is: neither conflicting nor behind. */
const upToDate = (pull: QueuedPull): boolean => pull.mergeState !== 'DIRTY' && pull.mergeState !== 'BEHIND';

const isQueued = (pull: QueuedPull): boolean => asked(pull) && pull.check === 'SUCCESS' && upToDate(pull);

/** Oldest place in the queue first, ties by number. */
const byQueuePlace = (left: QueuedPull, right: QueuedPull): number =>
  left.queuedAt === right.queuedAt
    ? left.number - right.number
    : (left.queuedAt ?? '').localeCompare(right.queuedAt ?? '');

/**
 * The batch: up to `maxBatch` queued PRs, oldest place first (ties by number), ending before a PR
 * with list-growth approval, which runs alone. `only` names PRs for a dry-run rehearsal, in its
 * order, whatever their queue state.
 */
export function pickBatch(
  pulls: readonly QueuedPull[],
  choice: { maxBatch: number; only?: readonly number[] },
): QueuedPull[] {
  const ordered = choice.only
    ? choice.only.map((number) => {
        const named = pulls.find((pull) => pull.number === number);
        if (!named) throw new Error(`#${number} is not open against main.`);
        return named;
      })
    : pulls.filter(isQueued).toSorted(byQueuePlace);
  // A PR with the owner's list-growth approval runs alone, so a batch never borrows its waiver for
  // another PR whose own approval may be gone.
  const approved = ordered.findIndex((pull) => pull.listGrowthApproved);
  return approved === 0
    ? ordered.slice(0, 1)
    : ordered.slice(0, approved === -1 ? choice.maxBatch : Math.min(approved, choice.maxBatch));
}

/** Why the PR as taken no longer stands for the PR now, or undefined. A superseded entry is cancelled. */
export function supersession(taken: QueuedPull, now: readonly QueuedPull[]): string | undefined {
  const current = now.find((pull) => pull.number === taken.number);
  if (!current) return `#${taken.number} was closed, merged or moved off main`;
  if (current.headSha !== taken.headSha) return `#${taken.number} was pushed to ${current.headSha}`;
  if (current.isDraft && !taken.isDraft) return `#${taken.number} went back to draft`;
  if (taken.check === 'SUCCESS' && current.check !== 'SUCCESS')
    return `#${taken.number}'s Check on ${taken.headSha} is ${current.check}`;
  if (current.listGrowthApproved !== taken.listGrowthApproved)
    return `#${taken.number}'s list-growth approval changed`;
  if (current.queuedAt !== taken.queuedAt)
    return current.queuedAt === null
      ? `#${taken.number} left the queue`
      : `#${taken.number} was queued again`;
  return undefined;
}

/**
 * Every integration run's attempt: each run has its own URL and results directory, so none is
 * rerun under its URL, and its verdict takes only results of this attempt (lib/testing/ci/queue-verdict.ts).
 */
export const INTEGRATION_ATTEMPT = 1;

/**
 * The environment of the batch prefix's integration run, on top of the runner's own: every job of
 * the run takes it. The run takes the list-growth approval of any PR in it (decision 0009, "a merge
 * queue").
 */
export function integrationEnvironment(run: {
  tip: BatchEntry;
  base: string;
  pulls: readonly QueuedPull[];
  runUrl: string;
  resultsDir: string;
  repository: string;
}): Record<string, string> {
  return {
    CI_EVENT: 'integration',
    CI_BASE_SHA: run.base,
    CI_RUN_URL: run.runUrl,
    CI_RUN_ATTEMPT: String(INTEGRATION_ATTEMPT),
    CI_RESULTS_DIR: run.resultsDir,
    CI_PRS: run.pulls.map((pull) => pull.number).join(','),
    SHRINK_ONLY_GROWTH_APPROVED: String(run.pulls.some((pull) => pull.listGrowthApproved)),
    CI_QUEUE_COMMIT: run.tip.commit,
    CI_QUEUE_REPOSITORY: run.repository,
  };
}

/**
 * One tick of the queue. A frozen queue does nothing. A live tick first withdraws a mark an earlier
 * tick left pending, merged or not; a withdrawal that fails freezes the queue. A live run without a
 * verdict is retried once, on the next tick, and the same work's second needs a person. A live tick ends by
 * updating the oldest queued PR that is behind main. A dry run builds, tests and decides, but never
 * lands, tells a PR, withdraws a mark, records a retry or updates a branch.
 */
export async function runQueueTick(
  adapter: QueueAdapter,
  options: { maxBatch: number; dryRun: boolean; only?: readonly number[] },
): Promise<QueueOutcome> {
  const base = await adapter.main();
  const outcome: QueueOutcome = {
    base: base.commit,
    dryRun: options.dryRun,
    batch: [],
    conflicts: [],
    runs: [],
    culprit: null,
    landing: [],
    stops: [],
    updated: null,
  };
  const state = await adapter.state();
  if (state.frozen !== null) {
    outcome.stops.push({ kind: 'frozen', detail: state.frozen });
    return outcome;
  }
  if (state.pending && !options.dryRun && !(await withdrawPending(adapter, state.pending, outcome)))
    return outcome;
  const batch = pickBatch(await adapter.pulls(), options);
  outcome.batch = batch.map((pull) => pull.number);
  const chain = await buildChain(adapter, base.commit, batch, outcome);
  if (chain.length) {
    const retry = options.dryRun ? undefined : (state.retry ?? null);
    const { verdicts, unanswered } = await bisect(adapter, base.commit, chain, outcome, retry);
    if (!options.dryRun) await recordRetry(adapter, state, outcome, unanswered);
    // A run without a verdict stops the tick: nothing lands and nobody is named.
    if (!needsAttention(outcome) && !outcome.stops.some((stop) => stop.kind === 'retry'))
      await settle(adapter, base, chain, verdicts, outcome);
  } else
    outcome.stops.push({
      kind: 'idle',
      detail: batch.length ? 'Every taken pull request conflicts with main.' : 'No pull request is queued.',
    });
  if (!options.dryRun && !needsAttention(outcome)) await updateOldestBehind(adapter, outcome);
  return outcome;
}

/**
 * Squashes the batch onto main one PR at a time. A PR that conflicts is left out, and so is a PR
 * whose migration would land out of order after a PR ahead of it: DEV applies migrations in
 * landing order and a fresh database in version order. The integration run checks each migration
 * against main before the batch; only the prefix a PR lands on shows the batch's own.
 */
async function buildChain(
  adapter: QueueAdapter,
  base: string,
  batch: readonly QueuedPull[],
  outcome: QueueOutcome,
): Promise<BatchEntry[]> {
  const chain: BatchEntry[] = [];
  for (const pull of batch) {
    const parent = chain.at(-1);
    const squashed = await adapter.squash(parent?.commit ?? base, pull);
    if (!squashed) {
      outcome.conflicts.push(pull.number);
      continue;
    }
    const entry = { pull, ...squashed };
    const problems = parent ? await adapter.migrationProblems(parent.commit, entry) : [];
    if (!problems.length) {
      chain.push(entry);
      continue;
    }
    outcome.conflicts.push(pull.number);
    outcome.stops.push({
      kind: 'migration-order',
      detail: `#${pull.number} waits for a later tick, which tests it on the main its batch left: ${problems.join(' ')}`,
    });
  }
  return chain;
}

/**
 * Saves the tick's retry record, or clears the earlier one once a tick reached its verdicts, so
 * only the same work's second run without one stops the queue.
 */
async function recordRetry(
  adapter: QueueAdapter,
  state: QueueState,
  outcome: QueueOutcome,
  unanswered: Retry | undefined,
): Promise<void> {
  if (unanswered) await adapter.saveState({ ...CLEAR, retry: unanswered });
  else if (state.retry && outcome.runs.length && !outcome.stops.some((stop) => stop.kind === 'inconclusive'))
    await adapter.saveState(CLEAR);
}

/**
 * While the ruleset requires up-to-date branches, GitHub reports a PR that lacks main as `BEHIND`,
 * and the queue cannot take it. The queue updates the oldest queued one with main, one at a time:
 * none while a queued PR that is up to date waits for its Check (pending or not yet posted) or
 * could land, since its landing
 * would leave the updated one behind again. A refused update waits for the next tick.
 */
async function updateOldestBehind(adapter: QueueAdapter, outcome: QueueOutcome): Promise<void> {
  try {
    const pulls = await adapter.pulls();
    const next = pulls.some(
      // An updated head shows `MISSING` until the runner posts its Check.
      (pull) => asked(pull) && upToDate(pull) && ['SUCCESS', 'PENDING', 'MISSING'].includes(pull.check),
    );
    const oldest = pulls
      .filter((pull) => asked(pull) && pull.mergeState === 'BEHIND' && pull.check === 'SUCCESS')
      .toSorted(byQueuePlace)[0];
    if (next || !oldest) return;
    try {
      await adapter.updateBranch(oldest);
      outcome.updated = oldest.number;
    } catch (error) {
      outcome.stops.push({
        kind: 'update-failed',
        detail: `#${oldest.number}'s branch could not be updated with main: ${message(error)}`,
      });
    }
  } catch (error) {
    outcome.stops.push({
      kind: 'update-failed',
      detail: `the pull requests could not be read: ${message(error)}`,
    });
  }
}

/**
 * Freezes the queue on a mark it could not withdraw, saved before the tick goes on: the green mark
 * may still stand, and only a person who checked GitHub clears it.
 */
async function freeze(
  adapter: QueueAdapter,
  mark: PendingMark,
  failure: string,
  outcome: QueueOutcome,
): Promise<void> {
  const frozen = `#${mark.pull}'s Queue success on ${mark.head} (${mark.runUrl}) may still stand: the queue could not withdraw it (${failure}). The queue lands nothing until a person confirms on GitHub that the newest Queue on ${mark.head} is not a success, merged or not, and clears the freeze.`;
  await adapter.saveState({ pending: mark, frozen });
  outcome.stops.push({ kind: 'frozen', detail: frozen });
}

/** Withdraws the mark; undefined when it did, otherwise why not. */
const withdrawal = (adapter: QueueAdapter, mark: PendingMark): Promise<string | undefined> =>
  adapter.withdraw(mark).then(
    () => undefined,
    (error: unknown) => message(error),
  );

/** Withdraws the mark and clears it; false when the withdrawal failed and froze the queue. */
async function withdrawPending(
  adapter: QueueAdapter,
  mark: PendingMark,
  outcome: QueueOutcome,
): Promise<boolean> {
  const failure = await withdrawal(adapter, mark);
  if (failure === undefined) await adapter.saveState(CLEAR);
  else await freeze(adapter, mark, failure, outcome);
  return failure === undefined;
}

const markOf = (pull: QueuedPull, proof: Verdict): PendingMark => ({
  pull: pull.number,
  head: pull.headSha,
  runUrl: proof.runUrl,
  verdict: 'success',
});

/**
 * Tests the whole batch, then on red the prefixes between the longest green and the shortest red
 * one, until they differ by one PR: that PR breaks the batch. When only the whole batch failed,
 * one rerun of its tree confirms it before its last PR is named. Returns each prefix's verdict, and
 * the retry record of a run without a verdict the next tick retries. A superseded prefix or a run
 * without a verdict ends the search (`noVerdict`).
 */
async function bisect(
  adapter: QueueAdapter,
  base: string,
  chain: readonly BatchEntry[],
  outcome: QueueOutcome,
  retry: Retry | null | undefined,
): Promise<{ verdicts: Map<number, Verdict>; unanswered?: Retry }> {
  const verdicts = new Map<number, Verdict>();
  const answered: Work[] = [];
  let green = 0;
  let red: number | undefined;
  let length: number | undefined = chain.length;
  let rerunOf: string | undefined;
  let confirming = false;
  while (length !== undefined) {
    const prefix = chain.slice(0, length);
    const tip = prefix.at(-1);
    const superseded = supersededIn(prefix, await adapter.pulls());
    if (!tip || superseded) {
      outcome.stops.push({ kind: 'superseded', detail: superseded ?? 'empty prefix' });
      break;
    }
    const pulls = prefix.map((entry) => entry.pull);
    const verdict = await adapter.integrationRun({ tip, base, pulls });
    const work = workOf(base, tip.tree, prefix);
    const contradicted = contradiction(work, verdict, outcome, retry);
    outcome.runs.push({
      prs: pulls.map((pull) => pull.number),
      tree: tip.tree,
      verdict,
      ...(rerunOf === undefined ? {} : { rerunOf }),
    });
    rerunOf = undefined;
    if (verdict.kind === 'inconclusive' || contradicted) {
      const stop = noVerdict(work, verdict, contradicted, retry);
      outcome.stops.push(stop);
      if (stop.kind === 'retry')
        return { verdicts, unanswered: retryOf(work, verdict, outcome, retry, answered) };
      break;
    }
    answered.push(work);
    verdicts.set(length, verdict);
    if (verdict.kind === 'passed') green = length;
    else red = length;
    length = red !== undefined && red - green > 1 ? Math.floor((green + red) / 2) : undefined;
    if (length === undefined && !confirming && red === chain.length && green === red - 1) {
      // The red stands only once the rerun is red too: a rerun that never runs names nobody.
      confirming = true;
      rerunOf = verdicts.get(red)?.runUrl;
      verdicts.delete(red);
      length = red;
    }
  }
  return { verdicts };
}

const supersededIn = (entries: readonly BatchEntry[], now: readonly QueuedPull[]): string | undefined =>
  entries
    .map((entry) => supersession(entry.pull, now))
    .filter((reason) => reason !== undefined)
    .join('; ') || undefined;

/**
 * Acts on the verdicts for the entries still current: names the PR whose prefix failed on a green
 * one, and lands the longest tested green prefix, only onto the base it was tested on.
 */
async function settle(
  adapter: QueueAdapter,
  base: MainCommit,
  chain: readonly BatchEntry[],
  verdicts: ReadonlyMap<number, Verdict>,
  outcome: QueueOutcome,
): Promise<void> {
  const now = await adapter.pulls();
  const superseded = chain.findIndex((entry) => supersession(entry.pull, now) !== undefined);
  const current = superseded === -1 ? chain.length : superseded;
  const reasons = supersededIn(chain, now);
  if (reasons && !outcome.stops.some((stop) => stop.kind === 'superseded'))
    outcome.stops.push({ kind: 'superseded', detail: reasons });
  const tested = [...verdicts]
    .filter(([length]) => length <= current)
    .toSorted(([left], [right]) => left - right);
  const passed = (length: number): boolean => length === 0 || verdicts.get(length)?.kind === 'passed';
  const breaking = tested.find(([length, verdict]) => verdict.kind === 'failed' && passed(length - 1));
  const culprit = breaking && chain[breaking[0] - 1];
  // The first PR's failure is its own only on a main the ledger proves green.
  if (breaking && culprit && breaking[0] === 1 && !(await adapter.proven(base.tree)))
    outcome.stops.push({
      kind: 'inconclusive',
      detail: `#${culprit.pull.number} fails on main, but the ledger does not prove main's tree ${base.tree} green`,
    });
  else if (breaking && culprit) {
    outcome.culprit = culprit.pull.number;
    if (!outcome.dryRun) await adapter.reject(culprit.pull, breaking[1]);
  }
  const proven = tested.findLast(([, verdict]) => verdict.kind === 'passed');
  if (!proven) return;
  const landing = chain.slice(0, proven[0]);
  if (!outcome.dryRun) await land(adapter, base.commit, landing, proven[1], outcome);
  else if (await onBase(adapter, base.commit, outcome))
    outcome.landing = landing.map((entry) => entry.pull.number);
}

/** Whether main still sits on `base`; otherwise the tick records a stale base. */
async function onBase(adapter: QueueAdapter, base: string, outcome: QueueOutcome): Promise<boolean> {
  const head = await adapter.main();
  if (head.commit === base) return true;
  outcome.stops.push({ kind: 'stale-base', detail: `main moved from ${base} to ${head.commit}` });
  return false;
}

/**
 * Lands each entry through GitHub's squash merge, in order. Before each merge main must sit on the
 * previous head and the PR must be as tested, its Check still a success; after it main must be one
 * new commit on the previous head holding exactly the entry's tree. Anything else stops the
 * landing; a PR that changed since its run has its `Queue` withdrawn. A landed PR's `Queue` is
 * withdrawn too, after it counts as landed: a success left on a merged head would pass that head
 * again onto a later main. A freeze stops the landing, and so does a read or call that throws,
 * which needs a person. A landing that stops after some PRs records where main stands: the last
 * merge the queue confirmed, or a merge GitHub reports whose tree the queue could not verify.
 */
async function land(
  adapter: QueueAdapter,
  base: string,
  landing: readonly BatchEntry[],
  proof: Verdict,
  outcome: QueueOutcome,
): Promise<void> {
  let previous = base;
  let landedTree: string | undefined;
  let unverified = false;
  for (const { pull, tree } of landing) {
    try {
      const head = await landNext(adapter, pull, tree, previous, proof, outcome);
      if (typeof head === 'string') {
        if (head) outcome.stops.push({ kind: 'landing-failed', detail: head });
        break;
      }
      if ('problem' in head) {
        unverified = true;
        await landedUnverified(adapter, pull, landing, head, proof, outcome);
        break;
      }
      outcome.landing.push(pull.number);
      previous = head.commit;
      landedTree = tree;
      if (!(await withdrawPending(adapter, markOf(pull, proof), outcome))) break;
    } catch (error) {
      const detail = `the landing stopped at #${pull.number}: ${message(error)}`;
      outcome.stops.push({ kind: 'landing-failed', detail });
      break;
    }
  }
  if (!unverified && landedTree !== undefined && outcome.landing.length < landing.length)
    stoppedPartway(landing, previous, landedTree, outcome);
}

/** Merges the next entry when main and the PR are still as tested: main after it, the problem, or '' when it was superseded. */
async function landNext(
  adapter: QueueAdapter,
  pull: QueuedPull,
  tree: string,
  previous: string,
  proof: Verdict,
  outcome: QueueOutcome,
): Promise<MainCommit | Unverified | string> {
  if (!(await onBase(adapter, previous, outcome))) return '';
  const superseded = supersession(pull, await adapter.pulls());
  if (!superseded) return landOne(adapter, pull, tree, previous, proof, outcome);
  outcome.stops.push({ kind: 'superseded', detail: superseded });
  await withdrawPending(adapter, markOf(pull, proof), outcome);
  return '';
}

const prs = (numbers: readonly number[]): string => numbers.map((number) => `#${number}`).join(', ');

/**
 * A merge after which main is not the tested tree on the previous head: main's head when it was
 * read (null when it could not be), and GitHub's merge commit for the PR when it reports one,
 * otherwise why a merge may still have landed.
 */
type Unverified = { problem: string; head: string | null } & (
  | { mergeCommit: string }
  | { unconfirmed: string }
);

/**
 * Records a merge after which main moved where the queue did not test, or could not be read, and
 * withdraws its mark. A PR GitHub reports merged counts as landed, its tree unverified; otherwise
 * the merge may have landed. Either way main moved or may have, so the `partial` stop has main's
 * own run of main's head start, and the tick needs a person.
 */
async function landedUnverified(
  adapter: QueueAdapter,
  pull: QueuedPull,
  landing: readonly BatchEntry[],
  merge: Unverified,
  proof: Verdict,
  outcome: QueueOutcome,
): Promise<void> {
  const all = prs(landing.map((entry) => entry.pull.number));
  outcome.stops.push({ kind: 'landing-failed', detail: merge.problem });
  if ('mergeCommit' in merge) outcome.landing.push(pull.number);
  outcome.stops.push({ kind: 'partial', detail: unverifiedDetail(pull, all, merge, prs(outcome.landing)) });
  await withdrawPending(adapter, markOf(pull, proof), outcome);
}

/** The `partial` stop's words for an unverified merge: where main stands, and that its own run runs its jobs. */
function unverifiedDetail(pull: QueuedPull, all: string, merge: Unverified, landed: string): string {
  const after = `the landing stopped after ${landed} of ${all}`;
  if (merge.head === null)
    return 'mergeCommit' in merge
      ? `${after}: GitHub reports #${pull.number} merged as ${merge.mergeCommit}, but main could not be read, so main's own run of main's head runs its jobs unless a run passed its exact landing, and the next tick reads main again`
      : `#${pull.number}'s merge may have landed after ${landed || 'nothing'} of ${all}: ${merge.unconfirmed}, so main's own run of main's head runs its jobs, and the next tick starts from main`;
  return 'mergeCommit' in merge
    ? `${after}: GitHub reports #${pull.number} merged as ${merge.mergeCommit}, and main's head ${merge.head} holds a tree no run of this tick verified, so main's own run of it runs its jobs, and the next tick starts from it`
    : `main moved to ${merge.head} after ${landed || 'nothing'} of ${all} without a merge of #${pull.number} GitHub confirms (${merge.unconfirmed}), so main's own run of ${merge.head} runs its jobs, and the next tick starts from it`;
}

/**
 * GitHub's word on whether the PR merged, after main moved to `head` or could not be read (`head`
 * null). Only a refused merge GitHub reports unmerged while main stayed unread did not land.
 */
async function mergeAfterUnverifiedMain(
  adapter: QueueAdapter,
  pull: QueuedPull,
  problem: string,
  head: string | null,
  refused: boolean,
): Promise<Unverified | string> {
  try {
    const mergeCommit = await adapter.mergeCommit(pull.number);
    if (mergeCommit) return { problem, head, mergeCommit };
    if (refused && head === null) return problem;
    return {
      problem,
      head,
      unconfirmed: refused
        ? 'GitHub reports it unmerged'
        : 'GitHub reports it unmerged although it accepted the merge',
    };
  } catch (error) {
    return { problem, head, unconfirmed: `GitHub could not confirm it (${message(error)})` };
  }
}

/**
 * Records a landing that stopped after some PRs of the tested prefix (D2: a batch's own main
 * commits are not tested one by one). Unless a run of this tick passed main's tree, no receipt of
 * the batch's runs passes it, so main's own run of that commit runs its jobs.
 */
function stoppedPartway(
  landing: readonly BatchEntry[],
  main: string,
  tree: string,
  outcome: QueueOutcome,
): void {
  const tested = outcome.runs.find((run) => run.tree === tree && run.verdict.kind === 'passed');
  const after = `the landing stopped after ${prs(outcome.landing)} of ${prs(landing.map((entry) => entry.pull.number))}: main's ${main}`;
  outcome.stops.push({
    kind: 'partial',
    detail: tested
      ? `${after} holds the tree that ${tested.verdict.runUrl} passed, and the next tick starts from it`
      : `${after} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
  });
}

/**
 * Merges one PR and returns main after it, or the problem. The PR's auto-merge goes off first, so
 * only this merge can use the `Queue` mark; when it cannot, no mark is posted. main's run the merge
 * would owe is saved next, or nothing is posted and merged. The mark is saved as
 * pending before it is posted. Every outcome but the tested tree on `previous` withdraws it here,
 * and a withdrawal that fails freezes the queue; `land` withdraws a merged PR's. After a merge
 * error the PR counts as landed only when GitHub reports it merged as main's new head: another
 * commit may have put the same tree onto `previous`. When main cannot be read after the merge, the
 * mark stays for `land`, which records the merge as unverified.
 */
async function landOne(
  adapter: QueueAdapter,
  pull: QueuedPull,
  tree: string,
  previous: string,
  proof: Verdict,
  outcome: QueueOutcome,
): Promise<MainCommit | Unverified | string> {
  try {
    await adapter.disableAutoMerge(pull);
  } catch (error) {
    return `#${pull.number}'s auto-merge could not be turned off (${message(error)}), so the queue posted no Queue success`;
  }
  try {
    await adapter.oweMainRun({
      base: outcome.base,
      prs: [...outcome.landing, pull.number],
      merging: pull.number,
    });
  } catch (error) {
    return `main's run it would owe could not be saved before merging #${pull.number} (${message(error)}), so the queue posted no Queue success`;
  }
  const mark = markOf(pull, proof);
  await adapter.saveState({ pending: mark, frozen: null });
  let refusal = '';
  try {
    await adapter.land(pull, proof);
  } catch (error) {
    refusal = `: ${message(error)}`;
  }
  let head: MainCommit;
  try {
    head = await adapter.main();
  } catch (error) {
    const unread = `main could not be read after merging #${pull.number}${refusal}: ${message(error)}`;
    const merge = await mergeAfterUnverifiedMain(adapter, pull, unread, null, refusal !== '');
    if (typeof merge !== 'string') return merge;
    await withdrawPending(adapter, mark, outcome);
    return merge;
  }
  if (head.commit === previous) {
    await withdrawPending(adapter, mark, outcome);
    return `GitHub did not merge #${pull.number}${refusal}`;
  }
  let problem: string;
  if (head.parents.length !== 1 || head.parents[0] !== previous)
    problem = `main moved to ${head.commit}, which is no single commit on ${previous}`;
  else if (head.tree !== tree)
    problem = `main's tree ${head.tree} after #${pull.number} is not the tested tree ${tree}`;
  else if (!refusal) return head;
  else
    try {
      if ((await adapter.mergeCommit(pull.number)) === head.commit) return head;
      problem = `GitHub did not merge #${pull.number}${refusal}; main moved to ${head.commit} without it`;
    } catch (error) {
      problem = `GitHub could not confirm #${pull.number} merged${refusal}: ${message(error)}`;
    }
  // Main moved, but not to the tested tree on `previous`: `land` asks for main's run of that head.
  const merge = await mergeAfterUnverifiedMain(adapter, pull, problem, head.commit, refusal !== '');
  return typeof merge === 'string' ? { problem, head: head.commit, unconfirmed: merge } : merge;
}
