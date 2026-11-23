// A run without a verdict is an environment question before it is a person's: the queue retries it
// once, recorded, on the next tick, and stops only on the same work's second. A PR is named only when its
// failure was seen twice: a red full batch whose prefixes passed runs once more before its last
// PR leaves the queue. Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import { fakeWorld, pull, sha } from '../fixtures/merge-queue-world';
import { needsAttention, type QueuedPull, runQueueTick } from './queue';

const LIVE = { maxBatch: 4, dryRun: false };

test('a first run without a verdict is retried on the next tick, recorded, and lands or names nothing', async () => {
  const world = fakeWorld([pull(1), pull(2)], { answer: () => 'inconclusive' });
  const first = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2]]);
  expect(first.stops).toEqual([{ kind: 'retry', detail: 'run-1:main+1+2: inconclusive' }]);
  expect(needsAttention(first)).toBe(false);
  expect(world.state()).toEqual({
    pending: null,
    frozen: null,
    retry: {
      unanswered: [
        {
          base: sha('main'),
          tree: 'main+1+2',
          pulls: [
            { number: 1, head: sha('head-1') },
            { number: 2, head: sha('head-2') },
          ],
          runUrl: 'run-1:main+1+2',
          detail: 'inconclusive',
        },
      ],
      seen: [],
    },
  });
  expect(world.landed).toEqual([]);
  expect(world.rejected).toEqual([]);
  // The retry has no verdict either: now it needs a person.
  const second = await runQueueTick(world.adapter, LIVE);
  expect(second.stops).toEqual([
    {
      kind: 'inconclusive',
      detail: 'run-2:main+1+2: inconclusive, after the retry of run-1:main+1+2 (inconclusive)',
    },
  ]);
  expect(needsAttention(second)).toBe(true);
});

test('a retry that reaches a verdict clears the record, so a later run without one is retried again', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    answer: (_prs, run) => (run === 1 ? 'inconclusive' : 'passed'),
  });
  await runQueueTick(world.adapter, LIVE);
  const retried = await runQueueTick(world.adapter, LIVE);
  expect(retried.landing).toEqual([1, 2]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
});

test('a bisection run without a verdict is retried as a whole on the next tick, and lands nothing now, not even a proved prefix', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], {
    answer: (prs) => (prs.length === 4 ? 'failed' : prs.length === 2 ? 'passed' : 'inconclusive'),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
  ]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['retry']);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(world.landed).toEqual([]);
});

test('a dry run and a tree that passed and failed in one tick still need a person at once', async () => {
  const dry = fakeWorld([pull(1)], { answer: () => 'inconclusive' });
  const rehearsal = await runQueueTick(dry.adapter, { maxBatch: 4, dryRun: true });
  expect(rehearsal.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
  expect(needsAttention(rehearsal)).toBe(true);
  expect(dry.state()).toEqual({ pending: null, frozen: null });
  const flaky = fakeWorld([pull(1), pull(2), pull(3), pull(4)], {
    unchanged: [3],
    answer: (prs) => (prs.length === 2 ? 'passed' : 'failed'),
  });
  const contradicted = await runQueueTick(flaky.adapter, LIVE);
  expect(contradicted.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
  expect(needsAttention(contradicted)).toBe(true);
});

test('a red full batch whose prefixes passed runs once more before its last PR is named, and the green prefix lands', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3), pull(4)], { breaks: [4] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([
    [1, 2, 3, 4],
    [1, 2],
    [1, 2, 3],
    [1, 2, 3, 4],
  ]);
  expect(outcome.runs.at(-1)).toMatchObject({ prs: [1, 2, 3, 4], rerunOf: 'run-1:main+1+2+3+4' });
  expect(outcome.culprit).toBe(4);
  expect(world.rejected).toEqual([4]);
  expect(world.landed).toEqual([1, 2, 3]);
});

test('a failed batch of one runs once more before its PR is named', async () => {
  const world = fakeWorld([pull(1)], { breaks: [1] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1], [1]]);
  expect(outcome.culprit).toBe(1);
  expect(world.rejected).toEqual([1]);
});

test('a red full batch that passes its rerun was a flake: nobody is named, nothing lands, and a person looks', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    answer: (prs, run) => (prs.length === 2 && run === 1 ? 'failed' : 'passed'),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2], [1], [1, 2]]);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(world.landed).toEqual([]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a culprit inside the batch is named without a rerun: the full batch and its own prefix both failed with it', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], { breaks: [2] });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2, 3], [1], [1, 2]]);
  expect(outcome.culprit).toBe(2);
});

test('a confirming rerun that ends without a verdict is retried on the next tick, not taken for a contradiction', async () => {
  const world = fakeWorld([pull(1)], { answer: (_prs, run) => (run === 1 ? 'failed' : 'inconclusive') });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1], [1]]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['retry']);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
});

test('a retried tick remembers the verdicts before the retry: a tree that failed then passes is a contradiction for a person', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    answer: (_prs, run) => (run === 1 ? 'failed' : run === 2 ? 'inconclusive' : 'passed'),
  });
  await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2], [1]]);
  const retried = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2], [1], [1, 2]]);
  expect(retried.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
  expect(retried.stops[0]?.detail).toContain('failed in run-1:main+1+2 but passed in run-3:main+1+2');
  expect(world.landed).toEqual([]);
  expect(needsAttention(retried)).toBe(true);
});

test('a red full batch whose confirming rerun could not run names nobody, even when its PR is current again when the tick settles', async () => {
  const world = fakeWorld([pull(1), pull(2)], { breaks: [2] });
  const read = world.adapter.pulls;
  let reads = 0;
  // Reads: the batch, the full batch's run, the prefix's run, then the confirming rerun's: #2's
  // Check is pending for that one read only.
  world.adapter.pulls = async () => {
    const now = await read();
    return ++reads === 4
      ? now.map((entry) => (entry.number === 2 ? { ...entry, check: 'PENDING' } : entry))
      : now;
  };
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2], [1]]);
  expect(outcome.culprit).toBe(null);
  expect(world.rejected).toEqual([]);
  expect(world.landed).toEqual([1]);
});

test('a retry belongs to the tree that ended without a verdict: other work that ends without one gets its own retry', async () => {
  const world = fakeWorld([pull(1), pull(2, { queuedAt: '2026-11-21T09:00:00Z' })], {
    answer: () => 'inconclusive',
    afterRun: (run, { pulls }) => {
      // #1 leaves the queue after its run, so the next tick takes #2.
      if (run === 1) pulls.splice(0, 1, pull(1, { queuedAt: null }));
    },
  });
  const one = { maxBatch: 1, dryRun: false };
  await runQueueTick(world.adapter, one);
  const other = await runQueueTick(world.adapter, one);
  expect(world.tested).toEqual([[1], [2]]);
  expect(other.stops.map((stop) => stop.kind)).toEqual(['retry']);
  expect(needsAttention(other)).toBe(false);
  // #2's own second run without a verdict needs a person.
  const again = await runQueueTick(world.adapter, one);
  expect(again.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
});

test('a retry belongs to the exact work: the same tree with other PRs, another base or another head gets its own retry', async () => {
  // #2 repeats #1's changes, so [1, 2] and [1] share a tree. The retried [1, 2] fails, then [1]
  // ends without a verdict: other PRs, so a retry of its own.
  const batch = fakeWorld([pull(1), pull(2)], {
    unchanged: [2],
    answer: (_prs, run) => (run === 2 ? 'failed' : 'inconclusive'),
  });
  await runQueueTick(batch.adapter, LIVE);
  const retried = await runQueueTick(batch.adapter, LIVE);
  expect(batch.tested).toEqual([[1, 2], [1, 2], [1]]);
  expect(retried.runs.map((run) => run.tree)).toEqual(['main+1', 'main+1']);
  expect(retried.stops.map((stop) => stop.kind)).toEqual(['retry']);
  // [1, 2] reached a verdict, so only [1]'s retry is outstanding.
  expect(batch.state().retry?.unanswered).toMatchObject([
    { tree: 'main+1', pulls: [{ number: 1, head: sha('head-1') }] },
  ]);
  // Main moves to another commit with the same tree, or #1 to another head with the same changes.
  const moves = {
    base: (world: { pushMain: (tree: string) => void }) => world.pushMain('main'),
    head: (world: { pulls: QueuedPull[] }) => world.pulls.splice(0, 1, pull(1, { headSha: sha('head-1b') })),
  };
  for (const move of Object.values(moves)) {
    const world = fakeWorld([pull(1)], {
      answer: () => 'inconclusive',
      afterRun: (run, state) => {
        if (run === 1) move(state);
      },
    });
    await runQueueTick(world.adapter, LIVE);
    const again = await runQueueTick(world.adapter, LIVE);
    expect(again.runs.map((run) => run.tree)).toEqual(['main+1']);
    expect(again.stops.map((stop) => stop.kind)).toEqual(['retry']);
    // That work's own second run without a verdict needs a person.
    const third = await runQueueTick(world.adapter, LIVE);
    expect(third.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
  }
});

test('a later retry keeps the verdicts of the earlier ones: a tree that failed before two retries and then passes is a contradiction for a person', async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    answer: (_prs, run) => (run === 1 ? 'failed' : run === 4 ? 'passed' : 'inconclusive'),
  });
  // Tick 1: [1, 2] fails, [1] has no verdict. Tick 2: [1, 2] has no verdict, other work.
  await runQueueTick(world.adapter, LIVE);
  const second = await runQueueTick(world.adapter, LIVE);
  expect(second.stops.map((stop) => stop.kind)).toEqual(['retry']);
  expect(world.state().retry?.seen).toEqual([
    { base: sha('main'), tree: 'main+1+2', kind: 'failed', runUrl: 'run-1:main+1+2' },
  ]);
  // Tick 3: [1, 2] passes, which tick 1 saw fail.
  const third = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2], [1], [1, 2], [1, 2]]);
  expect(third.stops.map((stop) => stop.kind)).toEqual(['inconclusive']);
  expect(third.stops[0]?.detail).toContain('failed in run-1:main+1+2 but passed in run-4:main+1+2');
  expect(world.landed).toEqual([]);
  expect(needsAttention(third)).toBe(true);
});

test("a batch without a verdict keeps its prefix's outstanding retry: the prefix's second run without one reaches a person by tick 3", async () => {
  // Sol's sequence with unchanged heads and base: [1, 2] fails and [1] has no verdict, then [1, 2]
  // has no verdict, and so on for six ticks. Each work's second run without a verdict needs a person.
  const world = fakeWorld([pull(1), pull(2)], {
    answer: (prs, run) => (prs.length === 2 && run % 3 === 1 ? 'failed' : 'inconclusive'),
  });
  const stops: string[][] = [];
  for (let tick = 1; tick <= 6; tick++) {
    const outcome = await runQueueTick(world.adapter, LIVE);
    stops.push(outcome.stops.map((stop) => stop.kind));
    if (needsAttention(outcome)) break;
  }
  expect(world.tested).toEqual([[1, 2], [1], [1, 2], [1, 2], [1]]);
  expect(stops).toEqual([['retry'], ['retry'], ['inconclusive']]);
  expect(world.landed).toEqual([]);
  expect(world.rejected).toEqual([]);
});
