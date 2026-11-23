// The merge queue's reading of GitHub: every open pull request against main with what the queue
// decides by (lib/testing/ci/queue.ts).
import { z } from 'zod';
import type { QueuedPull } from './queue';

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
