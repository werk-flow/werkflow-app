// The open pull requests as the machine runner reads them (lib/testing/ci/machine-runner.ts): with
// whether each comes from this repository and from whom, and never with a commit status, which no
// machine trusts as a verdict.
import { z } from 'zod';

/** An open PR against main as the runner reads it (RUNNER_PULLS_QUERY). Commit statuses never count. */
export type RunnerPull = {
  number: number;
  headSha: string;
  isDraft: boolean;
  queuedAt: string | null;
  mergeState: string;
  /** False for a PR from a fork. */
  sameRepository: boolean;
  /** GitHub's author association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, … */
  association: string;
  listGrowthApproved: boolean;
};

/** Every open PR against main with what the runner decides by. */
export const RUNNER_PULLS_QUERY = `query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 100, after: $endCursor) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number isDraft headRefOid mergeStateStatus isCrossRepository authorAssociation
        autoMergeRequest { enabledAt }
        labels(first: 100) { totalCount nodes { name } }
      }
    }
  }
}`;

const pullsPageSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequests: z.object({
        totalCount: z.number(),
        nodes: z.array(
          z.object({
            number: z.number().int().positive(),
            isDraft: z.boolean(),
            headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
            mergeStateStatus: z.string(),
            isCrossRepository: z.boolean(),
            authorAssociation: z.string(),
            autoMergeRequest: z.object({ enabledAt: z.string() }).nullable(),
            labels: z.object({ totalCount: z.number(), nodes: z.array(z.object({ name: z.string() })) }),
          }),
        ),
      }),
    }),
  }),
});

/** The PRs in GitHub's pages of answers to RUNNER_PULLS_QUERY. A truncated answer throws. */
export function runnerPullsFromGitHub(pages: unknown): RunnerPull[] {
  const answers = z.array(pullsPageSchema).min(1).parse(pages);
  const nodes = answers.flatMap((answer) => answer.data.repository.pullRequests.nodes);
  const total = answers[0]?.data.repository.pullRequests.totalCount;
  if (nodes.length !== total)
    throw new Error(`GitHub listed ${nodes.length} of ${total} open pull requests.`);
  return nodes.map((node) => {
    if (node.labels.nodes.length !== node.labels.totalCount)
      throw new Error(`GitHub listed only some of #${node.number}'s labels.`);
    return {
      number: node.number,
      headSha: node.headRefOid,
      isDraft: node.isDraft,
      queuedAt: node.autoMergeRequest?.enabledAt ?? null,
      mergeState: node.mergeStateStatus,
      sameRepository: !node.isCrossRepository,
      association: node.authorAssociation,
      listGrowthApproved: node.labels.nodes.some((label) => label.name === 'approved: list growth'),
    };
  });
}
