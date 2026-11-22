// What the merge queue reads from GitHub and hands its runner (lib/testing/ci/queue.ts): each open
// PR's queue place, head Check and approval from GitHub's pages, and the environment of an
// integration run.
import { expect, test } from 'bun:test';
import { type BatchEntry, integrationEnvironment, type QueuedPull } from './queue';
import { pullsFromGitHub } from './queue-github';

const MAIN = 'a'.repeat(40);
const TIP = 'b'.repeat(40);
const TREE = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);
const OLD = 'e'.repeat(40);

/** A queued PR as the runner's environment reads it: its number and its list-growth approval. */
const queued = (number: number, listGrowthApproved = false): QueuedPull => ({
  number,
  title: `PR ${number}`,
  headSha: HEAD,
  isDraft: false,
  queuedAt: '2026-11-21T08:00:00Z',
  check: 'SUCCESS',
  mergeState: 'BLOCKED',
  listGrowthApproved,
});

test("an integration run names the batch's base, PRs and run, and takes any PR's list-growth approval", () => {
  const tip: BatchEntry = { pull: queued(2), commit: TIP, tree: TREE };
  const environment = (pulls: QueuedPull[]) =>
    integrationEnvironment({
      tip,
      base: MAIN,
      pulls,
      runUrl: 'queue/1',
      resultsDir: '/runs/1',
      repository: '/queue',
    });
  expect(environment([queued(1), queued(2, true)])).toEqual({
    CI_EVENT: 'integration',
    CI_BASE_SHA: MAIN,
    CI_RUN_URL: 'queue/1',
    // Each run has its own URL, so its verdict takes only results of its first attempt.
    CI_RUN_ATTEMPT: '1',
    CI_RESULTS_DIR: '/runs/1',
    CI_PRS: '1,2',
    SHRINK_ONLY_GROWTH_APPROVED: 'true',
    CI_QUEUE_COMMIT: TIP,
    CI_QUEUE_REPOSITORY: '/queue',
  });
  expect(environment([queued(1)]).SHRINK_ONLY_GROWTH_APPROVED).toBe('false');
});

const node = (overrides: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'A change',
  isDraft: false,
  headRefOid: HEAD,
  mergeStateStatus: 'BLOCKED',
  autoMergeRequest: { enabledAt: '2026-11-21T08:00:00Z' },
  labels: { totalCount: 1, nodes: [{ name: 'approved: list growth' }] },
  commits: {
    nodes: [{ commit: { oid: HEAD, status: { contexts: [{ context: 'Check', state: 'SUCCESS' }] } } }],
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
      headSha: HEAD,
      isDraft: false,
      queuedAt: '2026-11-21T08:00:00Z',
      check: 'SUCCESS',
      mergeState: 'BLOCKED',
      listGrowthApproved: true,
    },
  ]);
  const olderHead = node({ commits: { nodes: [{ commit: { oid: OLD, status: null } }] } });
  expect(pullsFromGitHub(answer([olderHead]))[0]?.check).toBe('MISSING');
  expect(() => pullsFromGitHub(answer([node()], 101))).toThrow('GitHub listed 1 of 101');
  const pages = [...answer([node()], 2), ...answer([node({ number: 8 })], 2)];
  expect(pullsFromGitHub(pages).map((entry) => entry.number)).toEqual([7, 8]);
});
