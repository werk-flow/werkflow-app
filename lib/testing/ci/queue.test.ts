// The merge queue lands only a tested green prefix of a batch onto the main it was tested on, with
// main's tree equal to the tested tree after every merge, and names the PR that breaks a red batch.
// Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import { type Fake, fakeWorld, pull, sha } from '../fixtures/merge-queue-world';
import { mainFollowUp, mainRunOf } from './queue-main-run';
import { needsAttention, pickBatch, type QueuedPull, runQueueTick, supersession } from './queue';
import type { CiResult } from './results';
import { passedTree, provenTree, reusableReceipt } from './reuse';

/** main as a tick reads it: its head and the commits it holds, the head alone by default. */
const onMain = (commit: string, holds: readonly string[] = [commit]) => ({
  commit,
  contains: (other: string) => holds.includes(other),
});

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

// A tick that dies after GitHub accepted a merge never reaches its end, where it saves main's run
// it owes: so the run is saved before each merge is asked for, and the next tick pays it first
// (scripts/ci/queue.ts) before it touches the pending mark.
test("main's run a landing owes is saved before each merge is asked for, and no merge without it", async () => {
  const world = fakeWorld([pull(1), pull(2)]);
  const base = world.main().commit;
  await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([1, 2]);
  expect(world.owedAtLand).toEqual([
    { base, prs: [1], merging: 1 },
    { base, prs: [1, 2], merging: 2 },
  ]);

  const unsaved = fakeWorld([pull(1), pull(2)], { owingFails: true });
  const outcome = await runQueueTick(unsaved.adapter, LIVE);
  expect(unsaved.landed).toEqual([]);
  expect(unsaved.queueOn(sha('head-1'))).toBeUndefined();
  expect(needsAttention(outcome)).toBe(true);
  expect(outcome.stops.map((stop) => stop.detail).join(' ')).toContain(
    "main's run it would owe could not be saved",
  );
});

test('a green batch runs once and lands every PR in order, and main ends on the tested tree', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4), pull(5)]);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3, 4]]);
  expect(world.landed).toEqual([1, 2, 3, 4]);
  expect(world.pendingAtLand).toEqual([1, 2, 3, 4]);
  // Each PR's auto-merge is off before its Queue success, so the queue's own merge is the only one.
  expect(world.autoMergeAtLand).toEqual([false, false, false, false]);
  // Each landed head's Queue is withdrawn before its mark clears: with strict off, a green Queue left
  // on a merged head would pass the same head again onto a later main without a queue run.
  expect(world.withdrawn).toEqual([1, 2, 3, 4]);
  for (const number of [1, 2, 3, 4]) expect(world.queueOn(sha(`head-${number}`))).toBe('failure');
  expect(world.state()).toEqual({ pending: null, frozen: null });
  expect(outcome.landing).toEqual([1, 2, 3, 4]);
  expect(world.main().tree).toBe(outcome.runs[0]?.tree ?? 'untested');
  expect(outcome.stops).toEqual([]);
  expect(needsAttention(outcome)).toBe(false);
});

test('a failed batch of one names its PR after one confirming rerun, and lands nothing', async () => {
  const world = fakeWorld([pull(1)], { breaks: [1] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1], [1]]);
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

test('bisection names the last PR when only it breaks, after one confirming rerun, and lands the three before it', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [4] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
    [1, 2, 3, 4],
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
  expect(world.withdrawn).toEqual([1, 2]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
});

test("a merge whose answer was lost lands when GitHub confirms the PR merged as main's new head", async () => {
  const world = fakeWorld([pull(1), pull(2)], { lostAnswer: 1 });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1, 2]);
  expect(outcome.stops).toEqual([]);
  expect(world.withdrawn).toEqual([1, 2]);
  expect(world.main().tree).toBe('main+1+2');
});

/** Makes the n-th read of main fail, as `gh` losing its connection. */
function failMainRead(world: Fake, failOn: number): void {
  const read = world.adapter.main;
  let reads = 0;
  world.adapter.main = async () => {
    if (++reads === failOn) throw new Error('fetch failed');
    return read();
  };
}

test("a merge whose main cannot be read lands by GitHub's merge commit: the landing names it, unverified, and needs a person", async () => {
  for (const batch of [[pull(1)], [pull(1), pull(2)]]) {
    const world = fakeWorld(batch);
    // main: the tick, #1's base, then main after #1.
    failMainRead(world, 3);
    const outcome = await runQueueTick(world.adapter, LIVE);
    const prs = batch.map((entry) => `#${entry.number}`).join(', ');
    expect(world.landed).toEqual([1]);
    expect(outcome.landing).toEqual([1]);
    expect(world.withdrawn).toEqual([1]);
    expect(world.state()).toEqual({ pending: null, frozen: null });
    expect(outcome.stops).toEqual([
      { kind: 'landing-failed', detail: 'main could not be read after merging #1: fetch failed' },
      {
        kind: 'partial',
        detail: `the landing stopped after #1 of ${prs}: GitHub reports #1 merged as ${world.main().commit}, but main could not be read, so main's own run of main's head runs its jobs unless a run passed its exact landing, and the next tick reads main again`,
      },
    ]);
    expect(needsAttention(outcome)).toBe(true);
  }
});

test('a later merge whose main cannot be read records one partial stop, at its own merge commit', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)]);
  // main: the tick, #1's base, main after #1, #2's base, then main after #2.
  failMainRead(world, 5);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1, 2]);
  expect(world.withdrawn).toEqual([1, 2]);
  expect(outcome.stops).toEqual([
    { kind: 'landing-failed', detail: 'main could not be read after merging #2: fetch failed' },
    {
      kind: 'partial',
      detail: `the landing stopped after #1, #2 of #1, #2, #3: GitHub reports #2 merged as ${world.main().commit}, but main could not be read, so main's own run of main's head runs its jobs unless a run passed its exact landing, and the next tick reads main again`,
    },
  ]);
});

test("a merge whose main and merge commit cannot be read records that it may have landed, so main's run still starts", async () => {
  const world = fakeWorld([pull(1), pull(2)]);
  failMainRead(world, 3);
  world.adapter.mergeCommit = async () => {
    throw new Error('gh: connection reset');
  };
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([1]);
  expect(outcome.landing).toEqual([]);
  expect(world.withdrawn).toEqual([1]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
  expect(outcome.stops).toEqual([
    { kind: 'landing-failed', detail: 'main could not be read after merging #1: fetch failed' },
    {
      kind: 'partial',
      detail:
        "#1's merge may have landed after nothing of #1, #2: GitHub could not confirm it (gh: connection reset), so main's own run of main's head runs its jobs, and the next tick starts from main",
    },
  ]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a refused merge whose main cannot be read lands nothing when GitHub reports the PR unmerged', async () => {
  const world = fakeWorld([pull(1), pull(2)], { refuse: 1 });
  failMainRead(world, 3);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([]);
  expect(world.withdrawn).toEqual([1]);
  expect(outcome.stops).toEqual([
    {
      kind: 'landing-failed',
      detail: 'main could not be read after merging #1: Pull request is not mergeable: fetch failed',
    },
  ]);
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
  expect(world.withdrawn).toEqual([1, 2]);
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
  expect(world.tested).toEqual([[1, 2, 3], [1], [1, 2], [1, 2, 3]]);
  expect(world.landed).toEqual([1]);
  expect(outcome.stops.at(-1)).toEqual({
    kind: 'partial',
    detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds the tree that run-2:main+1 passed, and the next tick starts from it`,
  });
});

/** The work every plan of `runReceipts` requires. */
const WORK = ['browser:sql:grants', 'sql:sql:grants'];
/** A landing on main before the batch with that work. */
const landingOf = (tree: string) => ({ tree, base: sha('main'), work: WORK });

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
      attempt: 1,
      ...(job === 'plan' && ended
        ? { plan: { jobs: [], skips: {}, shards: [], outputs: {}, work: WORK } }
        : {}),
      ...(job === 'check' ? { planStartedAt: '2026-11-21T08:00:00Z' } : {}),
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
  expect(passedTree(batch, landingOf('main+1+2+3'), () => undefined)).toBe('run-1:main+1+2+3');
  // #1's own green fast tier ran on the same tree as main's new head, on the PR event.
  const ledger = [...batch, ...runReceipts(untested, 'pr/1', 'pr', true)];
  const key = (job: 'sql' | 'browser') => ({
    job,
    shard: job === 'browser' ? 1 : null,
    tree: untested,
    base: sha('main'),
    groups: ['sql:grants'],
    listGrowthApproved: false,
  });
  for (const entries of [ledger, ...ledger.map((entry) => [entry])]) {
    expect(passedTree(entries, landingOf(untested), () => undefined)).toBe(undefined);
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
  const world = fakeWorld([pull(1), pull(2)], { refuse: 1, failedWithdrawals: { 1: 1 } });
  const first = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([]);
  expect(world.main().commit).toBe(sha('main'));
  expect(world.autoMergeAtLand).toEqual([false]);
  const frozen = `#1's Queue success on ${sha('head-1')} (run-1:main+1+2) may still stand: the queue could not withdraw it (publisher unavailable). The queue lands nothing until a person confirms on GitHub that the newest Queue on ${sha('head-1')} is not a success, merged or not, and clears the freeze.`;
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
    failedWithdrawals: { 2: 1 },
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
  const world = fakeWorld([pull(1)], { failedWithdrawals: { 7: 1 }, state: { pending: mark, frozen: null } });
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

test('a pending mark a crashed tick left is withdrawn at the next tick start, whether its PR merged or not', async () => {
  // The process died between the merge and the withdrawal: the PR merged as main's head, and its
  // head's Queue success still stands, so a later merge of the same head would take it.
  const mark = { pull: 1, head: sha('head-1'), runUrl: 'run-0', verdict: 'success' as const };
  const merged = fakeWorld([], { state: { pending: mark, frozen: null } });
  merged.adapter.mergeCommit = async () => merged.main().commit;
  const unconfirmed = fakeWorld([], { state: { pending: mark, frozen: null } });
  unconfirmed.adapter.mergeCommit = async () => {
    throw new Error('gh failed');
  };
  const unmerged = fakeWorld([], { state: { pending: mark, frozen: null } });
  for (const world of [merged, unconfirmed, unmerged]) {
    const outcome = await runQueueTick(world.adapter, LIVE);
    expect(world.withdrawn).toEqual([1]);
    expect(world.queueOn(sha('head-1'))).toBe('failure');
    expect(world.state()).toEqual({ pending: null, frozen: null });
    expect(outcome.stops.map((stop) => stop.kind)).toEqual(['idle']);
  }
});

test("a landed PR whose Queue cannot be withdrawn freezes the queue: the merged head's success may still stand", async () => {
  const world = fakeWorld([pull(1), pull(2)], { failedWithdrawals: { 1: 1 } });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.landed).toEqual([1]);
  expect(outcome.landing).toEqual([1]);
  const mark = { pull: 1, head: sha('head-1'), runUrl: 'run-1:main+1+2', verdict: 'success' as const };
  const frozen = `#1's Queue success on ${sha('head-1')} (run-1:main+1+2) may still stand: the queue could not withdraw it (publisher unavailable). The queue lands nothing until a person confirms on GitHub that the newest Queue on ${sha('head-1')} is not a success, merged or not, and clears the freeze.`;
  expect(world.state()).toEqual({ pending: mark, frozen });
  expect(outcome.stops).toEqual([
    { kind: 'frozen', detail: frozen },
    {
      kind: 'partial',
      detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(needsAttention(outcome)).toBe(true);
  const still = await runQueueTick(world.adapter, LIVE);
  expect(still.stops).toEqual([{ kind: 'frozen', detail: frozen }]);
  expect(world.landed).toEqual([1]);
});

test('a read that fails between two merges records the partial landing with main after the first, and needs a person', async () => {
  for (const failing of ['pulls', 'main'] as const) {
    const world = fakeWorld([pull(1), pull(2)]);
    const { main, pulls } = world.adapter;
    let reads = 0;
    // pulls: the batch, the run, the settling, #1's check, then #2's. main: the tick, #1's base, main after #1, then #2's base.
    const failOn = failing === 'pulls' ? 5 : 4;
    const fail = async <Read>(read: () => Promise<Read>): Promise<Read> => {
      if (++reads === failOn) throw new Error('gh: connection reset');
      return read();
    };
    if (failing === 'pulls') world.adapter.pulls = () => fail(pulls);
    else world.adapter.main = () => fail(main);
    const outcome = await runQueueTick(world.adapter, LIVE);
    expect(world.landed).toEqual([1]);
    expect(outcome.landing).toEqual([1]);
    expect(world.withdrawn).toEqual([1]);
    expect(world.state()).toEqual({ pending: null, frozen: null });
    expect(outcome.stops).toEqual([
      { kind: 'landing-failed', detail: 'the landing stopped at #2: gh: connection reset' },
      {
        kind: 'partial',
        detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
      },
    ]);
    expect(needsAttention(outcome)).toBe(true);
  }
});

test('a merged PR still counts as landed when clearing its withdrawn mark fails, and the mark stays pending for the next tick', async () => {
  const world = fakeWorld([pull(1), pull(2)]);
  const save = world.adapter.saveState;
  let saves = 0;
  // Saves: #1's pending mark, then clearing it after its merge and withdrawal.
  world.adapter.saveState = async (state) => {
    if (++saves === 2) throw new Error('disk full');
    return save(state);
  };
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.landing).toEqual([1]);
  expect(world.queueOn(sha('head-1'))).toBe('failure');
  expect(world.state().pending?.pull).toBe(1);
  expect(outcome.stops).toEqual([
    { kind: 'landing-failed', detail: 'the landing stopped at #1: disk full' },
    {
      kind: 'partial',
      detail: `the landing stopped after #1 of #1, #2: main's ${world.main().commit} holds a prefix no run of this tick passed as a whole, so main's own run of it runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(needsAttention(outcome)).toBe(true);
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

test("main's run follows every live landing or partial stop once, on main's head with the tick's base, and never a dry run", async () => {
  const landed = await runQueueTick(fakeWorld([pull(1), pull(2)]).adapter, LIVE);
  expect(landed.landing).toEqual([1, 2]);
  const owed = mainFollowUp(landed, 'tick-1', 2);
  expect(owed).toEqual({ base: landed.base, prs: [1, 2], id: 'tick-1', merging: 2 });
  expect(owed && mainRunOf(owed, onMain(sha('head'), [sha('head')]), { merged: sha('head') })).toEqual({
    commit: sha('head'),
    base: landed.base,
    prs: [1, 2],
    id: 'tick-1',
  });
  // A merge that may have landed is a partial stop without a landing: the run is owed, and starts
  // only when main moved.
  const partial = mainFollowUp(
    { ...landed, landing: [], stops: [{ kind: 'partial', detail: 'may have landed' }] },
    'tick-2',
    1,
  );
  expect(partial).toEqual({ base: landed.base, prs: [], id: 'tick-2', merging: 1 });
  expect(partial && mainRunOf(partial, onMain(landed.base), { unmerged: true })).toBeUndefined();
  expect(mainFollowUp({ ...landed, dryRun: true }, 'tick-3', 2)).toBeUndefined();
  expect(mainFollowUp(await runQueueTick(fakeWorld([]).adapter, LIVE), 'tick-4', null)).toBeUndefined();
});

// A tick that restarts after a crash may read main before a merge GitHub accepted shows there. Only
// GitHub's word that the last merge asked for did not land lets an unmoved main clear the debt.
test('an owed main run clears on an unmoved main only once GitHub reports the merge it asked for unmerged', () => {
  const owed = { base: sha('main'), prs: [7], id: 'tick-1', merging: 7 };
  expect(mainRunOf(owed, onMain(sha('main')), { unknown: 'GitHub could not be read' })).toEqual({
    unresolved: "GitHub could not say whether #7 merged (GitHub could not be read), so main's run stays owed",
  });
  expect(mainRunOf(owed, onMain(sha('main')), { merged: sha('merged-7') })).toEqual({
    unresolved: `GitHub reports #7 merged as ${sha('merged-7')}, but main reads ${sha('main')}, which does not hold it yet, so main's run stays owed`,
  });
  expect(mainRunOf(owed, onMain(sha('main')), { unmerged: true })).toBeUndefined();
  // Unknown keeps the debt even when main moved: it runs once GitHub answers.
  expect(mainRunOf(owed, onMain(sha('head')), { unknown: 'timeout' })).toHaveProperty('unresolved');
  expect(mainRunOf(owed, onMain(sha('head')), { unmerged: true })).toEqual({
    commit: sha('head'),
    base: sha('main'),
    prs: [7],
    id: 'tick-1',
  });
});

// A tick that landed #7 (main B) and asked for #9 (main C) may read main at B while GitHub already
// reports #9's merge: a run of B would pay the debt that C's run owes.
test('an owed main run waits until the main it reads holds the merge GitHub reports for the last PR asked for', () => {
  const owed = { base: sha('base'), prs: [7, 9], id: 'tick-1', merging: 9 };
  const readsB = onMain(sha('first-merge'), [sha('base'), sha('first-merge')]);
  expect(mainRunOf(owed, readsB, { merged: sha('second-merge') })).toEqual({
    unresolved: `GitHub reports #9 merged as ${sha('second-merge')}, but main reads ${sha('first-merge')}, which does not hold it yet, so main's run stays owed`,
  });
  // Once main holds the merge, its head runs, whether the merge is the head or below it.
  const readsC = onMain(sha('second-merge'), [sha('base'), sha('first-merge'), sha('second-merge')]);
  expect(mainRunOf(owed, readsC, { merged: sha('second-merge') })).toEqual({
    commit: sha('second-merge'),
    base: sha('base'),
    prs: [7, 9],
    id: 'tick-1',
  });
  const readsD = onMain(sha('push'), [sha('base'), sha('first-merge'), sha('second-merge'), sha('push')]);
  expect(mainRunOf(owed, readsD, { merged: sha('second-merge') })).toHaveProperty('commit', sha('push'));
});
