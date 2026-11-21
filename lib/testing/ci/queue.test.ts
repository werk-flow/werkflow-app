// The merge queue lands only a tested green prefix of a batch onto the main it was tested on, with
// main's tree equal to the tested tree after every merge, and names the PR that breaks a red batch.
// Each case drives runQueueTick through a fake GitHub, git and runner.
import { expect, test } from 'bun:test';
import {
  type BatchEntry,
  integrationEnvironment,
  type MainCommit,
  needsAttention,
  pickBatch,
  pullsFromGitHub,
  type QueueAdapter,
  type QueuedPull,
  type RunEvidence,
  runQueueTick,
  supersession,
  type Verdict,
  verdictOf,
} from './queue';
import type { CiResult } from './results';

const sha = (seed: string): string => Buffer.from(seed).toString('hex').padEnd(40, '0').slice(0, 40);

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
  main: () => MainCommit;
};

/**
 * A fake world. A tree is the list of PRs squashed onto main. A run fails when its prefix holds a
 * PR of `breaks`, and `answer` can override a run's verdict. `afterRun` changes the world after
 * the n-th run (1-based). GitHub's merge squashes onto the current main, `mergeTree` may change
 * the tree it builds, and `refuse` makes the merge throw without merging. `beforeLand` changes the
 * world before the n-th merge. The ledger proves main's tree unless `unprovenMain`.
 */
function fakeWorld(
  pulls: QueuedPull[],
  options: {
    breaks?: readonly number[];
    answer?: (prs: readonly number[]) => Verdict['kind'] | undefined;
    afterRun?: (run: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
    mergeTree?: (tree: string) => string;
    refuse?: number;
    beforeLand?: (merge: number, world: { pulls: QueuedPull[]; pushMain: (tree: string) => void }) => void;
    unprovenMain?: boolean;
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
      const tree = `${commits.get(parent)?.tree}+${entry.number}`;
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
    land: async (entry) => {
      options.beforeLand?.(++merges, { pulls: open, pushMain });
      if (entry.number === options.refuse) throw new Error('Pull request is not mergeable');
      const tree = `${main().tree}+${entry.number}`;
      pushMain(options.mergeTree?.(tree) ?? tree);
      landed.push(entry.number);
      open = open.filter((candidate) => candidate.number !== entry.number);
    },
    reject: async (entry) => {
      rejected.push(entry.number);
    },
    withdraw: async (entry) => {
      withdrawn.push(entry.number);
    },
    proven: async (tree) => tree === 'main' && !options.unprovenMain,
  };
  return { adapter, tested, landed, rejected, withdrawn, main };
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
  ]);
  expect(world.withdrawn).toEqual([2]);
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
  expect(outcome.stops).toEqual([{ kind: 'superseded', detail: '#2 left the queue' }]);
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

const RUN = { commit: sha('tip'), tree: sha('tree'), base: sha('main'), runUrl: 'queue/1' };

function result(overrides: Partial<CiResult>): CiResult {
  return {
    version: 1,
    job: 'check',
    shard: null,
    event: 'integration',
    tree: RUN.tree,
    commit: RUN.commit,
    base: RUN.base,
    status: 'passed',
    groups: [],
    planReason: '',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: RUN.runUrl,
    startedAt: '2026-11-21T08:00:00Z',
    completedAt: '2026-11-21T09:00:00Z',
    ...overrides,
  };
}

const PLAN = result({ job: 'plan' });
const START = result({ job: 'plan', status: 'running', completedAt: null });
/** The run's evidence: its plan, its Check and its results; no ledger unless given. */
const evidence = (check: RunEvidence['check'], changes: Partial<RunEvidence> = {}): RunEvidence => ({
  plan: PLAN,
  check,
  results: [],
  ledger: undefined,
  ...changes,
});

test("only a CI runner's finished, passed Check of this run, commit and tree passes a batch", () => {
  expect(verdictOf(RUN, evidence(result({}))).kind).toBe('passed');
  for (const foreign of [
    { producer: null },
    { runUrl: 'queue/0' },
    { commit: sha('other') },
    { event: 'pr' as const },
  ])
    expect(verdictOf(RUN, evidence(result(foreign))).kind).toBe('inconclusive');
});

test("a pass needs a CI runner's passed plan of this run against the batch's base", () => {
  expect(verdictOf(RUN, evidence(result({}), { plan: result({ job: 'plan', base: 'HEAD' }) })).detail).toBe(
    `the plan diffed against HEAD, not the batch's base ${RUN.base}`,
  );
  for (const plan of [
    { unreadable: 'plan.json is missing' },
    result({ job: 'plan', runUrl: 'queue/0' }),
    result({ job: 'plan', status: 'failed' }),
    result({ job: 'plan', producer: null }),
  ])
    expect(verdictOf(RUN, evidence(result({}), { plan })).kind).toBe('inconclusive');
});

test("with a ledger, a pass counts only when the ledger holds the run as its tree's pass, so the push to main reuses it", () => {
  const passed = result({});
  expect(verdictOf(RUN, evidence(passed, { ledger: [START, PLAN, passed] })).kind).toBe('passed');
  expect(verdictOf(RUN, evidence(passed, { ledger: [] })).kind).toBe('inconclusive');
  expect(verdictOf(RUN, evidence(passed, { ledger: { unreadable: 'ledger.jsonl:3 is no JSON' } })).kind).toBe(
    'inconclusive',
  );
});

test('a missing Check result or one still running (a cancelled worker) is no verdict', () => {
  expect(verdictOf(RUN, evidence({ unreadable: 'check.json is missing' })).detail).toBe(
    'no Check result: check.json is missing',
  );
  expect(verdictOf(RUN, evidence(result({ status: 'running', completedAt: null }))).kind).toBe(
    'inconclusive',
  );
});

test('a failed Check counts against the batch only with a CI job of this run that failed a group; a missing artifact, a cancelled job or a changed checkout is no verdict', () => {
  const failedCheck = result({ status: 'failed' });
  const failedGroup = result({
    job: 'browser',
    shard: 1,
    status: 'failed',
    groups: [{ id: 'golden:p1-24a', outcome: 'failed', durationMs: 1 }],
  });
  expect(verdictOf(RUN, evidence(failedCheck, { results: [failedGroup] }))).toEqual({
    kind: 'failed',
    runUrl: RUN.runUrl,
    detail: 'failed: golden:p1-24a',
  });
  const noGroupRan = result({
    job: 'browser',
    shard: 1,
    status: 'failed',
    groups: [{ id: 'golden:p1-24a', outcome: 'not-run', durationMs: 0 }],
  });
  for (const results of [
    [noGroupRan, { unreadable: 'browser-2.json is missing' }],
    [{ ...failedGroup, runUrl: 'queue/0' }],
    [{ ...failedGroup, producer: null }],
    [{ ...failedGroup, status: 'running' as const, completedAt: null }],
  ])
    expect(verdictOf(RUN, evidence(failedCheck, { results })).kind).toBe('inconclusive');
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
