// The batching merge queue (owner decision D2, werk-flow/werkflow-planning#509). One tick takes up
// to four queued pull requests in queue order, squashes them onto main one by one, runs the
// integration run once on the batch's tip, and lands the PRs through GitHub's own merge when it
// passed. A red batch bisects over its prefixes, so the failure names its PR, and the tested green
// prefix before it lands. scripts/ci/queue-adapter.ts holds git, GitHub and the runner; every
// decision lives here.
import { z } from 'zod';
import type { CiResult, Ledger } from './results';
import { passedTree } from './reuse';

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

/** What the queue keeps between ticks: a mark it may have left green, and why it froze, if it did. */
export type QueueState = { pending: PendingMark | null; frozen: string | null };

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
  /** The integration run of `tip` (scripts/ci/job.ts through the runner) and its verdict. */
  integrationRun(run: { tip: BatchEntry; base: string; pulls: readonly QueuedPull[] }): Promise<Verdict>;
  /** Turns the PR's auto-merge off, so a green `Queue` alone never merges it. Throws when it cannot. */
  disableAutoMerge(pull: QueuedPull): Promise<void>;
  /** Marks the head as passed by the queue and squash-merges it on GitHub, only at that head. */
  land(pull: QueuedPull, proof: Verdict): Promise<void>;
  /** The PR's merge commit when GitHub reports it merged, otherwise null. */
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
 * `partial`: the landing stopped after some PRs of the tested prefix. Under D2 a batch's own main
 * commits are not tested one by one; main's own run of that commit runs its jobs unless a run passed
 * its exact tree, and the next tick starts from that main.
 */
type StopKind =
  | 'idle'
  | 'superseded'
  | 'inconclusive'
  | 'stale-base'
  | 'landing-failed'
  | 'frozen'
  | 'partial';

/** What one tick did, for its log and the runner. */
export type QueueOutcome = {
  base: string;
  dryRun: boolean;
  batch: number[];
  /** Taken PRs left out because they conflict with main and the PRs before them. */
  conflicts: number[];
  runs: { prs: number[]; tree: string; verdict: Verdict }[];
  /** The PR the failed batch names; in a dry run it is not told. */
  culprit: number | null;
  /** The PRs landed, in order; in a dry run the PRs it would land. */
  landing: number[];
  stops: { kind: StopKind; detail: string }[];
};

/** A tick that stopped on something a person has to look at: no verdict, a landing that broke, or a freeze. */
export function needsAttention(outcome: QueueOutcome): boolean {
  return outcome.stops.some(
    (stop) => stop.kind === 'inconclusive' || stop.kind === 'landing-failed' || stop.kind === 'frozen',
  );
}

const isQueued = (pull: QueuedPull): boolean =>
  !pull.isDraft &&
  pull.queuedAt !== null &&
  pull.check === 'SUCCESS' &&
  pull.mergeState !== 'DIRTY' &&
  pull.mergeState !== 'BEHIND';

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
    : pulls
        .filter(isQueued)
        .toSorted((left, right) =>
          left.queuedAt === right.queuedAt
            ? left.number - right.number
            : (left.queuedAt ?? '').localeCompare(right.queuedAt ?? ''),
        );
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

type Evidence = CiResult | { unreadable: string };

/** What the integration run `run` left: its plan, its Check, every job result, and the runner's ledger when the queue reads one. */
export type RunEvidence = {
  plan: Evidence;
  check: Evidence;
  results: readonly Evidence[];
  ledger: Ledger | undefined;
};

type IntegrationRun = { commit: string; tree: string; base: string; runUrl: string };

const ofRun =
  (run: IntegrationRun) =>
  (result: CiResult): boolean =>
    result.event === 'integration' &&
    result.commit === run.commit &&
    result.tree === run.tree &&
    result.runUrl === run.runUrl;

/** Why the run's plan and Check cannot stand for the run, or undefined. */
function proofProblem(run: IntegrationRun, plan: Evidence, check: Evidence): string | undefined {
  if ('unreadable' in plan) return `no plan: ${plan.unreadable}`;
  if (plan.job !== 'plan' || !ofRun(run)(plan))
    return `the plan is of another run (${plan.runUrl}, tree ${plan.tree})`;
  if (plan.base !== run.base) return `the plan diffed against ${plan.base}, not the batch's base ${run.base}`;
  if (plan.status !== 'passed' || plan.completedAt === null || plan.producer === null)
    return 'the plan did not pass on a CI runner';
  if ('unreadable' in check) return `no Check result: ${check.unreadable}`;
  if (check.job !== 'check' || !ofRun(run)(check))
    return `the Check result is of another run (${check.runUrl}, tree ${check.tree})`;
  if (check.status === 'running' || check.completedAt === null) return 'Check did not finish';
  if (check.producer === null) return 'Check ran outside a CI runner or on a changed checkout';
  return undefined;
}

/**
 * The verdict of the integration run `run`. Only a CI runner's finished plan of the batch's base
 * and Check of this run count. A pass counts only when the ledger, if the queue reads one, holds it
 * as the tree's pass, so the push to main reuses it. A failed Check counts against the batch only
 * when a CI runner's finished job of this run failed a group; otherwise the run proved nothing.
 */
export function verdictOf(run: IntegrationRun, evidence: RunEvidence): Verdict {
  const verdict = (kind: Verdict['kind'], detail: string): Verdict => ({ kind, runUrl: run.runUrl, detail });
  const { check, ledger } = evidence;
  const problem = proofProblem(run, evidence.plan, check);
  if (problem || 'unreadable' in check) return verdict('inconclusive', problem ?? 'no Check result');
  if (check.status === 'passed')
    return ledger === undefined || passedTree(ledger, run.tree, () => undefined) === run.runUrl
      ? verdict('passed', 'Check passed')
      : verdict('inconclusive', "Check passed, but the ledger does not hold the run as its tree's pass");
  const failed = evidence.results.flatMap((result) =>
    'unreadable' in result || !ofRun(run)(result) || result.producer === null || result.completedAt === null
      ? []
      : result.groups.filter((group) => group.outcome === 'failed').map((group) => group.id),
  );
  return failed.length
    ? verdict('failed', `failed: ${[...new Set(failed)].join(', ')}`)
    : verdict(
        'inconclusive',
        'Check failed, but no CI job of the run failed a group: a job was cancelled, lost its result or failed before its groups ran',
      );
}

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
    CI_RESULTS_DIR: run.resultsDir,
    CI_PRS: run.pulls.map((pull) => pull.number).join(','),
    SHRINK_ONLY_GROWTH_APPROVED: String(run.pulls.some((pull) => pull.listGrowthApproved)),
    CI_QUEUE_COMMIT: run.tip.commit,
    CI_QUEUE_REPOSITORY: run.repository,
  };
}

/**
 * One tick of the queue. A frozen queue does nothing. A live tick first withdraws a mark an earlier
 * tick left pending, merged or not; a withdrawal that fails freezes the queue. A dry run builds,
 * tests and decides, but never lands, tells a PR or withdraws a mark.
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
  const chain: BatchEntry[] = [];
  for (const pull of batch) {
    const squashed = await adapter.squash(chain.at(-1)?.commit ?? base.commit, pull);
    if (squashed) chain.push({ pull, ...squashed });
    else outcome.conflicts.push(pull.number);
  }
  if (!chain.length) {
    const detail = batch.length
      ? 'Every taken pull request conflicts with main.'
      : 'No pull request is queued.';
    outcome.stops.push({ kind: 'idle', detail });
    return outcome;
  }
  const verdicts = await bisect(adapter, base.commit, chain, outcome);
  // A run without a verdict stops the tick for a person: nothing lands and nobody is named.
  if (!needsAttention(outcome)) await settle(adapter, base, chain, verdicts, outcome);
  return outcome;
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
 * one, until they differ by one PR: that PR breaks the batch. Returns each tested prefix length's
 * verdict. A superseded entry in the next prefix or an inconclusive run ends the search.
 */
async function bisect(
  adapter: QueueAdapter,
  base: string,
  chain: readonly BatchEntry[],
  outcome: QueueOutcome,
): Promise<Map<number, Verdict>> {
  const verdicts = new Map<number, Verdict>();
  let green = 0;
  let red: number | undefined;
  let length: number | undefined = chain.length;
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
    // A PR that repeats changes already in the batch keeps the tree; a second run of a tree that
    // answers otherwise than its first is a flake and proves neither answer.
    const contradicted = outcome.runs.find(
      (run) => run.tree === tip.tree && run.verdict.kind !== verdict.kind,
    );
    outcome.runs.push({ prs: pulls.map((pull) => pull.number), tree: tip.tree, verdict });
    if (verdict.kind === 'inconclusive' || contradicted) {
      const detail = contradicted
        ? `tree ${tip.tree} ${contradicted.verdict.kind} in ${contradicted.verdict.runUrl} but ${verdict.kind} in ${verdict.runUrl}`
        : `${verdict.runUrl}: ${verdict.detail}`;
      outcome.stops.push({ kind: 'inconclusive', detail });
      break;
    }
    verdicts.set(length, verdict);
    if (verdict.kind === 'passed') green = length;
    else red = length;
    length = red !== undefined && red - green > 1 ? Math.floor((green + red) / 2) : undefined;
  }
  return verdicts;
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
 * merge the queue confirmed.
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
  for (const { pull, tree } of landing) {
    try {
      const head = await landNext(adapter, pull, tree, previous, proof, outcome);
      if (typeof head === 'string') {
        if (head) outcome.stops.push({ kind: 'landing-failed', detail: head });
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
  if (landedTree !== undefined && outcome.landing.length < landing.length)
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
): Promise<MainCommit | string> {
  if (!(await onBase(adapter, previous, outcome))) return '';
  const superseded = supersession(pull, await adapter.pulls());
  if (!superseded) return landOne(adapter, pull, tree, previous, proof, outcome);
  outcome.stops.push({ kind: 'superseded', detail: superseded });
  await withdrawPending(adapter, markOf(pull, proof), outcome);
  return '';
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
  const prs = (numbers: readonly number[]) => numbers.map((number) => `#${number}`).join(', ');
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
 * only this merge can use the `Queue` mark; when it cannot, no mark is posted. The mark is saved as
 * pending before it is posted. Every outcome but the tested tree on `previous` withdraws it here,
 * and a withdrawal that fails freezes the queue; `land` withdraws a merged PR's. After a merge
 * error the PR counts as landed only when GitHub reports it merged as main's new head: another
 * commit may have put the same tree onto `previous`.
 */
async function landOne(
  adapter: QueueAdapter,
  pull: QueuedPull,
  tree: string,
  previous: string,
  proof: Verdict,
  outcome: QueueOutcome,
): Promise<MainCommit | string> {
  try {
    await adapter.disableAutoMerge(pull);
  } catch (error) {
    return `#${pull.number}'s auto-merge could not be turned off (${message(error)}), so the queue posted no Queue success`;
  }
  const mark = markOf(pull, proof);
  await adapter.saveState({ pending: mark, frozen: null });
  let refusal = '';
  try {
    await adapter.land(pull, proof);
  } catch (error) {
    refusal = `: ${message(error)}`;
  }
  let problem: string;
  try {
    const head = await adapter.main();
    if (head.commit === previous) problem = `GitHub did not merge #${pull.number}${refusal}`;
    else if (head.parents.length !== 1 || head.parents[0] !== previous)
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
  } catch (error) {
    problem = `main could not be read after merging #${pull.number}${refusal}: ${message(error)}`;
  }
  await withdrawPending(adapter, mark, outcome);
  return problem;
}

const gitHubPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  isDraft: z.boolean(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
  mergeStateStatus: z.string(),
  autoMergeRequest: z.object({ enabledAt: z.string().datetime() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })), totalCount: z.number() }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          oid: z.string(),
          status: z
            .object({ contexts: z.array(z.object({ context: z.string(), state: z.string() })) })
            .nullable(),
        }),
      }),
    ),
  }),
});

/** The query `pullsFromGitHub` reads: every open PR against main with what the queue decides by. */
export const PULLS_QUERY = `query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 100, after: $endCursor) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number title isDraft headRefOid mergeStateStatus
        autoMergeRequest { enabledAt }
        labels(first: 100) { totalCount nodes { name } }
        commits(last: 1) { nodes { commit { oid status { contexts { context state } } } } }
      }
    }
  }
}`;

const pullsAnswerSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequests: z.object({ totalCount: z.number(), nodes: z.array(gitHubPullSchema) }),
    }),
  }),
});

/**
 * The PRs in GitHub's pages of answers to `PULLS_QUERY` (`gh api graphql --paginate --slurp`). A
 * truncated answer throws: a missing PR could be a superseded one.
 */
export function pullsFromGitHub(pages: unknown): QueuedPull[] {
  const answers = z.array(pullsAnswerSchema).min(1).parse(pages);
  const totalCount = answers[0]?.data.repository.pullRequests.totalCount;
  const nodes = answers.flatMap((answer) => answer.data.repository.pullRequests.nodes);
  if (nodes.length !== totalCount)
    throw new Error(`GitHub listed ${nodes.length} of ${totalCount} open pull requests.`);
  return nodes.map((node) => {
    if (node.labels.nodes.length !== node.labels.totalCount)
      throw new Error(
        `GitHub listed ${node.labels.nodes.length} of #${node.number}'s ${node.labels.totalCount} labels.`,
      );
    const head = node.commits.nodes[0]?.commit;
    const check =
      head?.oid === node.headRefOid
        ? head.status?.contexts.find((context) => context.context === 'Check')?.state
        : undefined;
    return {
      number: node.number,
      title: node.title,
      headSha: node.headRefOid,
      isDraft: node.isDraft,
      queuedAt: node.autoMergeRequest?.enabledAt ?? null,
      check: check ?? 'MISSING',
      mergeState: node.mergeStateStatus,
      listGrowthApproved: node.labels.nodes.some((label) => label.name === 'approved: list growth'),
    };
  });
}
