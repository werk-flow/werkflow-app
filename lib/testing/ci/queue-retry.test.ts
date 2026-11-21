// A run without a verdict is an environment question before it is a person's: the queue retries it
// once, recorded, on the next tick, and stops only on the second. A PR is named only when its
// failure was seen twice: a red full batch whose prefixes passed runs once more before its last
// PR leaves the queue. Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import { fakeWorld, pull } from '../fixtures/merge-queue-world';
import { needsAttention, runQueueTick } from './queue';

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
    retry: { runUrl: 'run-1:main+1+2', detail: 'inconclusive', seen: [] },
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
