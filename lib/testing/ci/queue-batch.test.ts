// The merge queue keeps a batch to what landing it one PR at a time proves: no PR's migration
// conflicts with another's ahead of it, a merge that moves main anywhere but the tested tree asks
// for main's run of the head it left, and under strict up-to-date branches the queue freshens one
// queued PR at a time. Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import { fakeWorld, pull, sha } from '../fixtures/merge-queue-world';
import { needsAttention, runQueueTick } from './queue';

const LIVE = { maxBatch: 4, dryRun: false };

test('a PR whose migration conflicts with the migration of a PR ahead of it in the batch waits for a later tick, and the batch goes on without it', async () => {
  // #2's migration has the lower version and changes what #1's newer one changes: DEV would apply
  // #1's first and a fresh database #2's first. Main before the batch shows neither.
  const world = fakeWorld([pull(1), pull(2), pull(3)], { migrationConflicts: { 2: 1 } });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 3]]);
  expect(outcome.batch).toEqual([1, 2, 3]);
  expect(outcome.conflicts).toEqual([2]);
  expect(outcome.landing).toEqual([1, 3]);
  expect(outcome.stops).toEqual([
    {
      kind: 'migration-order',
      detail:
        "#2 waits for a later tick, which tests it on the main its batch left: #2's migration changes what #1's newer migration changes.",
    },
  ]);
  expect(needsAttention(outcome)).toBe(false);
  expect(world.rejected).toEqual([]);
});

test('a first PR is checked against main by its integration run, not against the batch', async () => {
  const world = fakeWorld([pull(1), pull(2)], { migrationConflicts: { 1: 2 } });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.tested).toEqual([[1, 2]]);
  expect(outcome.landing).toEqual([1, 2]);
});

test("a first merge that moves main to another tree than the tested one records it unverified and asks for main's run of main's head", async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    mergeTree: (tree) => (tree.endsWith('+1') ? `${tree}*` : tree),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  const head = world.main().commit;
  expect(world.landed).toEqual([1]);
  // GitHub merged #1, so it counts as landed, with its tree unverified.
  expect(outcome.landing).toEqual([1]);
  expect(outcome.stops).toEqual([
    {
      kind: 'landing-failed',
      detail: "main's tree main+1* after #1 is not the tested tree main+1",
    },
    {
      kind: 'partial',
      detail: `the landing stopped after #1 of #1, #2: GitHub reports #1 merged as ${head}, and main's head ${head} holds a tree no run of this tick verified, so main's own run of it runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(world.withdrawn).toEqual([1]);
  expect(world.state()).toEqual({ pending: null, frozen: null });
  expect(needsAttention(outcome)).toBe(true);
});

test("a refused merge while another commit moved main asks for main's run of the head main moved to", async () => {
  const world = fakeWorld([pull(1), pull(2)], {
    refuse: 1,
    beforeLand: (merge, { pushMain }) => {
      if (merge === 1) pushMain('main+1');
    },
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  const head = world.main().commit;
  expect(world.landed).toEqual([]);
  expect(outcome.landing).toEqual([]);
  expect(outcome.stops).toEqual([
    {
      kind: 'landing-failed',
      detail: `GitHub did not merge #1: Pull request is not mergeable; main moved to ${head} without it`,
    },
    {
      kind: 'partial',
      detail: `main moved to ${head} after nothing of #1, #2 without a merge of #1 GitHub confirms (GitHub reports it unmerged), so main's own run of ${head} runs its jobs, and the next tick starts from it`,
    },
  ]);
  expect(world.withdrawn).toEqual([1]);
  expect(needsAttention(outcome)).toBe(true);
});

test('a later merge whose tree differs from the tested one still names the head main moved to', async () => {
  const world = fakeWorld([pull(1), pull(2), pull(3)], {
    mergeTree: (tree) => (tree.endsWith('+2') ? `${tree}*` : tree),
  });
  const outcome = await runQueueTick(world.adapter, LIVE);
  const head = world.main().commit;
  expect(outcome.landing).toEqual([1, 2]);
  expect(outcome.stops.map((stop) => stop.kind)).toEqual(['landing-failed', 'partial']);
  expect(outcome.stops[1]?.detail).toContain(`main's head ${head} holds a tree no run of this tick verified`);
});

const behind = { mergeState: 'BEHIND' };

test('while strict up-to-date branches are on, a tick updates the oldest queued PR that is behind main, and only that one', async () => {
  const world = fakeWorld([
    pull(3, behind),
    pull(1, behind),
    pull(2, { ...behind, isDraft: true }),
    pull(4, { ...behind, check: 'FAILURE' }),
    pull(5, { ...behind, queuedAt: null }),
  ]);
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(world.updated).toEqual([1]);
  expect(outcome.updated).toBe(1);
  expect(needsAttention(outcome)).toBe(false);
  // The updated PR now waits for its Check: the next tick updates no other one.
  const next = await runQueueTick(world.adapter, LIVE);
  expect(world.updated).toEqual([1]);
  expect(next.updated).toBeNull();
});

test('a tick that lands updates the oldest queued PR the landing left behind, by the PRs as they are after it', async () => {
  // #2 is up to date until #1 lands; a tick that decided by the PRs before the landing would wait.
  const world = fakeWorld([pull(1), pull(2)], {
    beforeLand: (merge, { pulls }) => {
      if (merge === 1) pulls.splice(1, 1, pull(2, behind));
    },
  });
  const outcome = await runQueueTick(world.adapter, { maxBatch: 1, dryRun: false });
  expect(outcome.landing).toEqual([1]);
  expect(world.updated).toEqual([2]);
});

test('a queued PR that is up to date keeps every behind PR waiting, and a dry run updates nothing', async () => {
  const pending = fakeWorld([pull(1, { check: 'PENDING' }), pull(2, behind)]);
  await runQueueTick(pending.adapter, LIVE);
  expect(pending.updated).toEqual([]);
  const dry = fakeWorld([pull(1, behind)]);
  await runQueueTick(dry.adapter, { maxBatch: 4, dryRun: true });
  expect(dry.updated).toEqual([]);
});

test('an update GitHub refuses is recorded and needs no person: the next tick asks again', async () => {
  const world = fakeWorld([pull(1, behind)], { updateFails: true });
  const outcome = await runQueueTick(world.adapter, LIVE);
  expect(outcome.updated).toBeNull();
  expect(outcome.stops).toContainEqual({
    kind: 'update-failed',
    detail: "#1's branch could not be updated with main: GitHub refused the update",
  });
  expect(needsAttention(outcome)).toBe(false);
  expect(sha('main')).toBe(world.main().commit);
});
