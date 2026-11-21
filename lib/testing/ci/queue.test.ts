// The merge queue lands only a tested green prefix of a batch onto the main it was tested on, with
// main's tree equal to the tested tree after every merge, and names the PR that breaks a red batch.
// Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  type BatchEntry,
  integrationEnvironment,
  type MainCommit,
  needsAttention,
  pickBatch,
  pullsFromGitHub,
  type QueueAdapter,
  type QueuedPull,
  type QueueState,
  runQueueTick,
  supersession,
  type Verdict,
} from './queue';
import type { CiResult } from './results';
import { passedTree, provenTree, reusableReceipt } from './reuse';

/** A fake commit id of the whole seed, so two children of one parent never share an id. */
const sha = (seed: string): string => createHash('sha1').update(seed).digest('hex');

function pull(number: number, overrides: Partial<QueuedPull> = {}): QueuedPull {
  return {
    number,
    title: `PR ${number}`,
    headSha: sha(`head-${number}`),
    isDraft: false,
    queuedAt: `2026-11-21T08:0${number}:00Z`,
    check: 'SUCCESS',
    mergeState: 'BLOCKED',
    listGrowthApproved: false,
    ...overrides,
  };
}

type Fake = {
  adapter: QueueAdapter;
  /** The PR sets each integration run tested, in order. */
  tested: number[][];
  landed: number[];
  rejected: number[];
  withdrawn: number[];
  /** The pending mark's PR when each merge was asked for: the mark is saved before it is posted. */
  pendingAtLand: (number | null)[];
  /** Whether the PR's auto-merge was still on when its `Queue` success and merge were asked for. */
  autoMergeAtLand: boolean[];
  main: () => MainCommit;
  state: () => QueueState;
};

/**
 * A fake world. A tree is the list of PRs squashed onto main. A run fails when its prefix holds a
 * PR of `breaks`, and `answer` can override a run's verdict. `afterRun` changes the world after
 * the n-th run (1-based). GitHub's merge squashes onto the current main, `mergeTree` may change
 * the tree it builds, `refuse` makes the merge throw without merging, and `lostAnswer` makes it
 * throw after merging. GitHub reports a merged PR's merge commit. `beforeLand` changes the world
 * before the n-th merge. The ledger proves main's tree unless `unprovenMain`. A PR of
 * `unchanged` holds only changes already in the batch, so its squash keeps the tree. The publisher
 * is down for the first `failedWithdrawals` withdrawals. GitHub refuses to turn off the auto-merge
 * of `stuckAutoMerge`. The queue's saved state starts as `state`.
 */
function fakeWorld(
  pulls: QueuedPull[],
  options: {
    breaks?: readonly number[];
    answer?: (prs: readonly number[]) => Verdict['kind'] | undefined;
    afterRun?: (run: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
    mergeTree?: (tree: string) => string;
    refuse?: number;
    lostAnswer?: number;
    beforeLand?: (merge: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
    unprovenMain?: boolean;
    unchanged?: readonly number[];
    failedWithdrawals?: number;
    stuckAutoMerge?: number;
    state?: QueueState;
  } = {},
): Fake {
  const commits = new Map<string, { parents: string[]; tree: string }>([
    [sha('main'), { parents: [], tree: 'main' }],
  ]);
  let mainCommit = sha('main');
  let open = [...pulls];
  const tested: number[][] = [];
  const landed: number[] = [];
  const rejected: number[] = [];
  const withdrawn: number[] = [];
  const pendingAtLand: (number | null)[] = [];
  const autoMergeAtLand: boolean[] = [];
  let saved: QueueState = options.state ?? { pending: null, frozen: null };
  let withdrawals = 0;
  const mergeCommits = new Map<number, string>();
  let merges = 0;
  const commit = (parent: string, tree: string): string => {
    const id = sha(`${parent}:${tree}`);
    commits.set(id, { parents: [parent], tree });
    return id;
  };
  const pushMain = (tree: string): void => {
    mainCommit = commit(mainCommit, tree);
  };
  const main = (): MainCommit => ({
    commit: mainCommit,
    ...(commits.get(mainCommit) ?? { parents: [], tree: '' }),
  });
  const adapter: QueueAdapter = {
    main: async () => main(),
    pulls: async () => open,
    squash: async (parent, entry) => {
      if (entry.title.includes('conflict')) return undefined;
      const before = `${commits.get(parent)?.tree}`;
      const tree = options.unchanged?.includes(entry.number) ? before : `${before}+${entry.number}`;
      return { commit: commit(parent, tree), tree };
    },
    integrationRun: async ({ tip, pulls: prefix }) => {
      const prs = prefix.map((entry) => entry.number);
      tested.push(prs);
      const kind =
        options.answer?.(prs) ??
        (prs.some((number) => options.breaks?.includes(number)) ? 'failed' : 'passed');
      options.afterRun?.(tested.length, {
        pulls: open,
        pushMain,
      });
      open = [...open];
      return { kind, runUrl: `run-${tested.length}:${tip.tree}`, detail: kind };
    },
    disableAutoMerge: async (entry) => {
      if (entry.number === options.stuckAutoMerge) throw new Error('GitHub refused');
      open = open.map((candidate) =>
        candidate.number === entry.number ? { ...candidate, queuedAt: null } : candidate,
      );
    },
    land: async (entry) => {
      pendingAtLand.push(saved.pending?.pull ?? null);
      autoMergeAtLand.push(
        open.some((candidate) => candidate.number === entry.number && candidate.queuedAt !== null),
      );
      options.beforeLand?.(++merges, { pulls: open, pushMain });
      if (entry.number === options.refuse) throw new Error('Pull request is not mergeable');
      const tree = `${main().tree}+${entry.number}`;
      pushMain(options.mergeTree?.(tree) ?? tree);
      landed.push(entry.number);
      mergeCommits.set(entry.number, mainCommit);
      open = open.filter((candidate) => candidate.number !== entry.number);
      if (entry.number === options.lostAnswer) throw new Error('connection reset');
    },
    mergeCommit: async (number) => mergeCommits.get(number) ?? null,
    reject: async (entry) => {
      rejected.push(entry.number);
    },
    withdraw: async (mark) => {
      if (++withdrawals <= (options.failedWithdrawals ?? 0)) throw new Error('publisher unavailable');
      withdrawn.push(mark.pull);
    },
    state: async () => saved,
    saveState: async (state) => {
      saved = state;
    },
    proven: async (tree) => tree === 'main' && !options.unprovenMain,
  };
  return {
    adapter,
    tested,
    landed,
    rejected,
    withdrawn,
    pendingAtLand,
    autoMergeAtLand,
    main,
    state: () => saved,
  };
}

const LIVE = { maxBatch: 4, dryRun: false };

test('a batch takes at most four queued PRs by queue place; drafts, unqueued, unchecked, conflicting and behind PRs wait', () => {
  const pulls = [
    pull(9, { queuedAt: '2026-11-21T07:00:00Z' }),
    pull(1),
    pull(2, { isDraft: true }),
    pull(3, { queuedAt: null }),
    pull(4, { check: 'PENDING' }),
    pull(5, { mergeState: 'DIRTY' }),
    pull(6, { mergeState: 'BEHIND' }),
    pull(7),
    pull(8, { queuedAt: '2026-11-21T08:01:00Z' }),
    pull(10, { queuedAt: '2026-11-21T09:00:00Z' }),
    pull(11, { queuedAt: '2026-11-21T09:30:00Z' }),
  ];
  expect(pickBatch(pulls, { maxBatch: 4 }).map((entry) => entry.number)).toEqual([9, 1, 8, 7]);
  expect(pickBatch(pulls, { maxBatch: 1 }).map((entry) => entry.number)).toEqual([9]);
});

test('a PR with list-growth approval runs alone, so no batch borrows its waiver for another PR', () => {
  const approved = { listGrowthApproved: true };
  const numbers = (pulls: QueuedPull[]) => pickBatch(pulls, { maxBatch: 4 }).map((entry) => entry.number);
  expect(numbers([pull(1), pull(2), pull(3, approved), pull(4)])).toEqual([1, 2]);
  expect(numbers([pull(1, approved), pull(2), pull(3)])).toEqual([1]);
});

test('a rehearsal batch takes the named open PRs in their order, and refuses a PR that is not open against main', () => {
  const pulls = [pull(1), pull(2, { isDraft: true, queuedAt: null })];
  expect(pickBatch(pulls, { maxBatch: 4, only: [2, 1] }).map((entry) => entry.number)).toEqual([2, 1]);
  expect(() => pickBatch(pulls, { maxBatch: 4, only: [1, 3] })).toThrow('#3 is not open against main');
});

test('a green batch runs once and lands every PR in order, and main ends on the tested tree', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4), pull(5)]);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3, 4]]);
  expect(world.landed).toEqual([1, 2, 3, 4]);
  expect(world.pendingAtLand).toEqual([1, 2, 3, 4]);
  // Each PR's auto-merge is off before its Queue success, so the queue's own merge is the only one.
  expect(world.autoMergeAtLand).toEqual([false, false, false, false]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
  expect(outcome.landing).toEqual([1, 2, 3, 4]);
  expect(world.main().tree).toBe(outcome.runs[0]?.tree ?? 'untested');
  expect(outcome.stops).toEqual([]);
  expect(needsAttention(outcome)).toBe(false);
});

test('a failed batch of one names its PR without bisection and lands nothing', async () => {
  const world = fakeWorld([pull(1)], { breaks: [1] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1]]);
  expect(outcome.culprit).toBe(1);
  expect(world.rejected).toEqual([1]);
  expect(world.landed).toEqual([]);
  expect(world.main().commit).toBe(sha('main'));
});

test('bisection names the PR whose prefix fails on a green one, lands the green prefix before it and leaves the rest queued', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [3] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
  ]);
  expect(outcome.culprit).toBe(3);
  expect(world.rejected).toEqual([3]);
  expect(world.landed).toEqual([1, 2]);
  expect(world.main().tree).toBe('main+1+2');
});

test('bisection names the first PR when it breaks the batch, and lands nothing', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [1] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3, 4], [1, 2], [1]]);
  expect(outcome.culprit).toBe(1);
  expect(world.landed).toEqual([]);
});

test('bisection names the last PR when only it breaks, and lands the three before it', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [4] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
  ]);
  expect(outcome.culprit).toBe(4);
  expect(world.landed).toEqual([1, 2, 3]);
});

test('a stale base lands nothing: main moved while the batch ran', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    afterRun: (_run, { pushMain }) => pushMain('main+outside'),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['stale-base']);
  expect(needsAttention(outcome)).toBe(false);
});

test('a run without a verdict (a cancelled worker, a missing result) lands nothing, names no PR and needs a person', async () => {
  const world = fakeWorld([pull(1), pull(2)], { answer: () => 'inconclusive' });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2]]);
  expect(world.landed).toEqual([]);
  expect(world.rejected).toEqual([]);
  expect(outcome.culprit).toBe(null);
  expect(needsAttention(outcome)).toBe(true);
});

test('a bisection run without a verdict stops the search, names no PR and lands nothing, not even a proved prefix', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], {
    answer: (prs) => (prs.length === 4 ? 'failed' : prs.length === 2 ? 'passed' : 'inconclusive'),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
  ]);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(world.landed).toEqual([]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a tree that passed and failed in one tick is no verdict: nobody is named and its pass lands nothing', async () => {
  // #3 repeats #2's change, so [1, 2] and [1, 2, 3] are one tree, and its second run contradicts its first.
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], {
    unchanged: [3],
    answer: (prs) => (prs.length === 2 ? 'passed' : 'failed'),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
  ]);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(world.landed).toEqual([]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a PR pushed while its batch ran is cancelled: nothing at or after it lands, and an untested shorter prefix never lands', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    afterRun: (_run, { pulls }) => {
      pulls.splice(1, 1, pull(2, { headSha: sha('newer') }));
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3]]);
  expect(world.landed).toEqual([]);
  expect(outcome.stops).toEqual([{ kind: 'superseded', detail: `#2 was pushed to ${sha('newer')}` }]);
});

test('a superseded entry ends the bisection before the next run, and its prefix names no PR', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], {
    breaks: [2],
    afterRun: (run, { pulls }) => {
      if (run === 1) pulls.splice(0, 1);
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3, 4]]);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(outcome.stops).toEqual([{ kind: 'superseded', detail: '#1 was closed, merged or moved off main' }]);
});

test('a PR that went back to draft or left the queue is superseded; one that was never queued is not', () => {
  const now = [pull(1, { isDraft: true }), pull(2, { queuedAt: null }), pull(3, { queuedAt: null })];
  expect(supersession(pull(1), now)).toBe('#1 went back to draft');
  expect(supersession(pull(2), now)).toBe('#2 left the queue');
  expect(supersession(pull(3, { queuedAt: null }), now)).toBe(undefined);
  expect(supersession(pull(4), [pull(4, { queuedAt: '2026-11-21T10:00:00Z' })])).toBe('#4 was queued again');
  expect(supersession(pull(5, { listGrowthApproved: true }), [pull(5)])).toBe(
    "#5's list-growth approval changed",
  );
  expect(supersession(pull(6), [pull(6, { check: 'FAILURE' })])).toBe(
    `#6's Check on ${sha('head-6')} is FAILURE`,
  );
  // A rehearsal may take a red PR on purpose; only a Check that stopped being a success supersedes.
  expect(supersession(pull(7, { check: 'FAILURE' }), [pull(7, { check: 'FAILURE' })])).toBe(undefined);
});

test('a PR that conflicts with the batch so far is left out and the rest is tested without it', async () => {
  const world = fakeWorld([pull(1), pull(2, { title: 'conflict' }), pull(3)]);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.conflicts).toEqual([2]);
  expect(world.tested).toEqual([[1, 3]]);
  expect(world.landed).toEqual([1, 3]);
});

test('an empty queue runs nothing', async () => {
  const world = fakeWorld([pull(1, { queuedAt: null })]);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['idle']);
});

test('a landed tree that differs from the tested tree stops the landing at that PR and needs a person', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    mergeTree: (tree) => (tree.endsWith('+2') ? `${tree}*` : tree),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1]);
  expect(world.landed).toEqual([1, 2]);
  expect(outcome.stops[0]?.detail).toContain('is not the tested tree');
  expect(needsAttention(outcome)).toBe(true);
});

test('a merge GitHub refuses stops the landing with its reason', async () => {
  const world = fakeWorld([pull(1), pull(2)], { refuse: 2 });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1]);
  expect(outcome.stops).toEqual([
    { kind: 'landing-failed', detail: 'GitHub did not merge #2: Pull request is not mergeable' },
    {
      kind: 'partial',
      detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(world.withdrawn).toEqual([2]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
});

test('a merge GitHub refuses lands nothing even when another commit put the tested tree onto main, and withdraws the mark', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    refuse: 1,
    beforeLand: (merge, { pushMain }) => {
      if (merge === 1) pushMain('main+1');
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([]);
  expect(outcome.landing).toEqual([]);
  expect(outcome.stops).toEqual([
    {
      kind: 'landing-failed',
      detail: `GitHub did not merge #1: Pull request is not mergeable; main moved to ${world.main().commit} without it`,
    },
  ]);
  expect(world.withdrawn).toEqual([1]);
  expect(needsAttention(outcome)).toBe(true);
});

test("a merge whose answer was lost lands when GitHub confirms the PR merged as main's new head", async () => {
  const world = fakeWorld([pull(1), pull(2)], { lostAnswer: 1 });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1, 2]);
  expect(outcome.stops).toEqual([]);
  expect(world.withdrawn).toEqual([]);
  expect(world.main().tree).toBe('main+1+2');
});

test('a main that cannot be read after a merge stops the landing and withdraws the mark', async () => {
  const world = fakeWorld([pull(1)]);
  const read = world.adapter.main;
  let reads = 0;
  world.adapter.main = async () => {
    if (++reads === 3) throw new Error('fetch failed');
    return read();
  };
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.stops).toEqual([
    { kind: 'landing-failed', detail: 'main could not be read after merging #1: fetch failed' },
  ]);
  expect(world.withdrawn).toEqual([1]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a first PR failing on a main the ledger does not prove green is not named, and needs a person', async () => {
  const world = fakeWorld([pull(1), pull(2)], { breaks: [1], unprovenMain: true });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(outcome.stops[0]?.detail).toContain("the ledger does not prove main's tree main green");
  expect(needsAttention(outcome)).toBe(true);
});

test('a later PR is named on its own green prefix, whatever the ledger says about main', async () => {
  const world = fakeWorld([pull(1), pull(2)], { breaks: [2], unprovenMain: true });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.culprit).toBe(2);
  expect(world.landed).toEqual([1]);
});

test('each merge first checks main and the PR again: a PR taken out of the queue during the landing is not merged', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    beforeLand: (merge, { pulls }) => {
      if (merge === 1) pulls.splice(1, 1, pull(2, { queuedAt: null }));
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([1]);
  // main now holds #1 alone, a prefix no run tested as a whole (D2): the tick records it, main's own
  // run of it runs its jobs, and the next tick starts from it.
  expect(outcome.stops).toEqual([
    { kind: 'superseded', detail: '#2 left the queue' },
    {
      kind: 'partial',
      detail: `the landing stopped after #1 of #1, #2, #3: main's ${world.main().commit} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(world.withdrawn).toEqual([2]);
  expect(needsAttention(outcome)).toBe(false);
});

test('a landing stopped after a prefix a bisection run passed says so: main holds a tested tree', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    breaks: [3],
    beforeLand: (merge, { pulls }) => {
      if (merge === 1) pulls.splice(1, 1, pull(2, { headSha: sha('newer') }));
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3], [1], [1, 2]]);
  expect(world.landed).toEqual([1]);
  expect(outcome.stops.at(-1)).toEqual({
    kind: 'partial',
    detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds the tree that run-2:main+1 passed, and the next tick starts from it`,
  });
});

/** Every receipt one run leaves in the runner's ledger: Plan's, a job's and a browser shard's start and end, and its Check. */
function runReceipts(tree: string, runUrl: string, event: CiResult['event'], passed: boolean): CiResult[] {
  const receipt = (job: CiResult['job'], shard: number | null, ended: boolean): CiResult => {
    const status = !ended ? 'running' : passed ? 'passed' : 'failed';
    return {
      version: 1,
      job,
      shard,
      event,
      tree,
      commit: sha(tree),
      base: sha('main'),
      status,
      groups: [{ id: 'sql:grants', outcome: status === 'running' ? 'not-run' : status, durationMs: 0 }],
      planReason: '',
      reusedFrom: null,
      listGrowthApproved: false,
      producer: 'mac-standin',
      runUrl,
      startedAt: '2026-11-21T08:00:00Z',
      completedAt: ended ? '2026-11-21T09:00:00Z' : null,
    };
  };
  return [
    receipt('plan', null, false),
    receipt('plan', null, true),
    receipt('sql', null, false),
    receipt('sql', null, true),
    receipt('browser', 1, false),
    receipt('browser', 1, true),
    receipt('check', null, true),
  ];
}

test("a landing stopped after an untested prefix leaves main on a tree that no receipt of the batch's runs passes, so main's push runs its jobs", async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    beforeLand: (merge, { pulls }) => {
      if (merge === 1) pulls.splice(1, 1, pull(2, { queuedAt: null }));
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  const untested = world.main().tree;
  expect(untested).toBe('main+1');
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['superseded', 'partial']);
  const batch = outcome.runs.flatMap((run) =>
    runReceipts(run.tree, run.verdict.runUrl, 'integration', run.verdict.kind === 'passed'),
  );
  // The batch's pass stands for its own tip, so the receipts are ones the reuse rule reads.
  expect(passedTree(batch, 'main+1+2+3', () => undefined)).toBe('run-1:main+1+2+3');
  // #1's own green fast tier ran on the same tree as main's new head, on the PR event.
  const ledger = [...batch, ...runReceipts(untested, 'pr/1', 'pr', true)];
  const key = (job: 'sql' | 'browser') => ({
    job,
    shard: job === 'browser' ? 1 : null,
    tree: untested,
    groups: ['sql:grants'],
    listGrowthApproved: false,
  });
  for (const entries of [ledger, ...ledger.map((entry) => [entry])]) {
    expect(passedTree(entries, untested, () => undefined)).toBe(undefined);
    expect(provenTree(entries, untested)).toBe(undefined);
  }
  for (const entries of [batch, ...batch.map((entry) => [entry])])
    for (const job of ['sql', 'browser'] as const)
      expect(reusableReceipt(entries, key(job), 'main')).toBe(undefined);
});

test('a PR whose Check went pending on the same head after its run is not landed, and its Queue is withdrawn', async () => {
  const world = fakeWorld([pull(1), pull(2)]);
  const read = world.adapter.pulls;
  let reads = 0;
  // Reads: the batch, the run, the settling, then the check right before #1's mark.
  world.adapter.pulls = async () => {
    const now = await read();
    return ++reads < 4
      ? now
      : now.map((entry) => (entry.number === 1 ? { ...entry, check: 'PENDING' } : entry));
  };
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2]]);
  expect(world.landed).toEqual([]);
  expect(world.pendingAtLand).toEqual([]);
  expect(world.withdrawn).toEqual([1]);
  expect(outcome.stops).toEqual([
    { kind: 'superseded', detail: `#1's Check on ${sha('head-1')} is PENDING` },
  ]);
});

test('a refused merge whose withdrawal fails freezes the queue at once, after its auto-merge was turned off', async () => {
  const world = fakeWorld([pull(1), pull(2)], { refuse: 1, failedWithdrawals: 1 });
  const first = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([]);
  expect(world.main().commit).toBe(sha('main'));
  expect(world.autoMergeAtLand).toEqual([false]);
  const frozen = `#1's Queue success on ${sha('head-1')} (run-1:main+1+2) may still stand: the queue could not withdraw it (publisher unavailable). The queue lands nothing until a person confirms on GitHub that #1 merged or that the newest Queue on ${sha('head-1')} is not a success, and clears the freeze.`;
  expect(first.stops).toEqual([
    { kind: 'frozen', detail: frozen },
    { kind: 'landing-failed', detail: 'GitHub did not merge #1: Pull request is not mergeable' },
  ]);
  // Saved before the tick ends, so a crash or a restart cannot lose it.
  expect(world.state()).toEqual({
    pending: { pull: 1, head: sha('head-1'), runUrl: 'run-1:main+1+2', verdict: 'success' },
    frozen,
  });
  expect(needsAttention(first)).toBe(true);

  // The publisher is back, but only a person lifts the freeze: the queue neither retries nor lands.
  for (const dryRun of [false, true]) {
    const still = await runQueueTick(world.adapter, { maxBatch: 4, dryRun });
    expect(still.stops).toEqual([{ kind: 'frozen', detail: frozen }]);
    expect(still.batch).toEqual([]);
  }
  expect(world.tested).toEqual([[1, 2]]);
  expect(world.withdrawn).toEqual([]);
  expect(world.landed).toEqual([]);
});

test('a PR whose auto-merge cannot be turned off gets no Queue success and is not merged', async () => {
  const world = fakeWorld([pull(1), pull(2)], { stuckAutoMerge: 1 });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.pendingAtLand).toEqual([]);
  expect(world.landed).toEqual([]);
  expect(world.withdrawn).toEqual([]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
  expect(outcome.stops).toEqual([
    {
      kind: 'landing-failed',
      detail:
        "#1's auto-merge could not be turned off (GitHub refused), so the queue posted no Queue success",
    },
  ]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a superseded PR whose withdrawal fails during the landing freezes the queue too', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    failedWithdrawals: 1,
    beforeLand: (merge, { pulls }) => {
      if (merge === 1) pulls.splice(1, 1, pull(2, { headSha: sha('newer') }));
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([1]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['superseded', 'frozen', 'partial']);
  expect(world.state().frozen).toContain(`#2's Queue success on ${sha('head-2')}`);
  expect(needsAttention(outcome)).toBe(true);
});

test('a pending mark a crashed tick left, which the next tick cannot withdraw, freezes the queue until a person clears it', async () => {
  const mark = { pull: 7, head: sha('head-7'), runUrl: 'run-0', verdict: 'success' as const };
  const world = fakeWorld([pull(1)], { failedWithdrawals: 1, state: { pending: mark, frozen: null } });
  const frozen = await runQueueTick(world.adapter, LIVE);
  expect(frozen.stops.map((stop) => stop.kind)).toEqual(['frozen']);
  expect(frozen.stops[0]?.detail).toContain(`#7's Queue success on ${sha('head-7')}`);
  expect(world.state()).toEqual({ pending: mark, frozen: frozen.stops[0]?.detail ?? 'no freeze' });
  expect(world.tested).toEqual([]);
  expect(needsAttention(frozen)).toBe(true);
  const still = await runQueueTick(world.adapter, LIVE);
  expect(still.stops.map((stop) => stop.kind)).toEqual(['frozen']);
  expect(world.tested).toEqual([]);
  expect(world.withdrawn).toEqual([]);
});

test("a pending mark whose PR merged as main's head is cleared without a withdrawal; one merged under a later head is withdrawn", async () => {
  // The process died between the merge and clearing the mark.
  const mark = { pull: 1, head: sha('head-1'), runUrl: 'run-0', verdict: 'success' as const };
  const merged = fakeWorld([], { state: { pending: mark, frozen: null } });
  merged.adapter.mergeCommit = async () => merged.main().commit;
  expect((await runQueueTick(merged.adapter, LIVE)).stops.map((stop) => stop.kind)).toEqual(['idle']);
  expect(merged.withdrawn).toEqual([]);
  expect(merged.state()).toEqual({ pending: null, frozen: null });

  const earlier = fakeWorld([], { state: { pending: mark, frozen: null } });
  earlier.adapter.mergeCommit = async () => sha('older');
  await runQueueTick(earlier.adapter, LIVE);
  expect(earlier.withdrawn).toEqual([1]);
  expect(earlier.state()).toEqual({ pending: null, frozen: null });
});

test('a pending mark whose PR did not merge, or whose merge GitHub cannot confirm, is withdrawn first', async () => {
  const mark = { pull: 7, head: sha('head-7'), runUrl: 'run-0', verdict: 'success' as const };
  const unconfirmed = fakeWorld([], { state: { pending: mark, frozen: null } });
  unconfirmed.adapter.mergeCommit = async () => {
    throw new Error('gh failed');
  };
  for (const world of [fakeWorld([], { state: { pending: mark, frozen: null } }), unconfirmed]) {
    const outcome = await runQueueTick(world.adapter, LIVE);
    expect(world.withdrawn).toEqual([7]);
    expect(world.state()).toEqual({ pending: null, frozen: null });
    expect(outcome.stops.map((stop) => stop.kind)).toEqual(['idle']);
  }
});

test('a dry run neither settles nor clears a pending mark', async () => {
  const mark = { pull: 7, head: sha('head-7'), runUrl: 'run-0', verdict: 'success' as const };
  const world = fakeWorld([pull(1)], { state: { pending: mark, frozen: null } });
  await runQueueTick(world.adapter, { maxBatch: 4, dryRun: true });
  expect(world.withdrawn).toEqual([]);
  expect(world.state().pending).toEqual(mark);
});

test('a dry run tests and decides like a live tick but never lands or tells a PR', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [3] });
  const outcome = await runQueueTick(world.adapter, { maxBatch: 4, dryRun: true });
  expect(world.tested.length).toBe(3);
  expect(outcome.culprit).toBe(3);
  expect(outcome.landing).toEqual([1, 2]);
  expect(world.landed).toEqual([]);
  expect(world.rejected).toEqual([]);
  expect(world.main().commit).toBe(sha('main'));
});

test("an integration run names the batch's base, PRs and run, and takes any PR's list-growth approval", () => {
  const tip: BatchEntry = { pull: pull(2), commit: sha('tip'), tree: sha('tree') };
  const environment = (pulls: QueuedPull[]) =>
    integrationEnvironment({
      tip,
      base: sha('main'),
      pulls,
      runUrl: 'queue/1',
      resultsDir: '/runs/1',
      repository: '/queue',
    });
  expect(environment([pull(1), pull(2, { listGrowthApproved: true })])).toEqual({
    CI_EVENT: 'integration',
    CI_BASE_SHA: sha('main'),
    CI_RUN_URL: 'queue/1',
    CI_RESULTS_DIR: '/runs/1',
    CI_PRS: '1,2',
    SHRINK_ONLY_GROWTH_APPROVED: 'true',
    CI_QUEUE_COMMIT: sha('tip'),
    CI_QUEUE_REPOSITORY: '/queue',
  });
  expect(environment([pull(1)]).SHRINK_ONLY_GROWTH_APPROVED).toBe('false');
});

const node = (overrides: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'A change',
  isDraft: false,
  headRefOid: sha('head'),
  mergeStateStatus: 'BLOCKED',
  autoMergeRequest: { enabledAt: '2026-11-21T08:00:00Z' },
  labels: { totalCount: 1, nodes: [{ name: 'approved: list growth' }] },
  commits: {
    nodes: [{ commit: { oid: sha('head'), status: { contexts: [{ context: 'Check', state: 'SUCCESS' }] } } }],
  },
  ...overrides,
});
const answer = (nodes: unknown[], totalCount = nodes.length) => [
  { data: { repository: { pullRequests: { totalCount, nodes } } } },
];

test("GitHub's pages give each PR's queue place, its head's Check and its approval; a truncated answer throws", () => {
  expect(pullsFromGitHub(answer([node()]))).toEqual([
    {
      number: 7,
      title: 'A change',
      headSha: sha('head'),
      isDraft: false,
      queuedAt: '2026-11-21T08:00:00Z',
      check: 'SUCCESS',
      mergeState: 'BLOCKED',
      listGrowthApproved: true,
    },
  ]);
  const olderHead = node({ commits: { nodes: [{ commit: { oid: sha('old'), status: null } }] } });
  expect(pullsFromGitHub(answer([olderHead]))[0]?.check).toBe('MISSING');
  expect(() => pullsFromGitHub(answer([node()], 101))).toThrow('GitHub listed 1 of 101');
  const pages = [...answer([node()], 2), ...answer([node({ number: 8 })], 2)];
  expect(pullsFromGitHub(pages).map((entry) => entry.number)).toEqual([7, 8]);
});
