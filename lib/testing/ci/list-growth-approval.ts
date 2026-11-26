import { z } from 'zod';

// Which pull request each commit of a merge-queue run belongs to, with its labels, for the growth
// approval of shrink-only lists (scripts/ci/prepare.ts, approval). Only GitHub's own records bind a commit to a PR: the merge
// queue's entries while they run, and the PR GitHub merged as that commit once it landed. A commit
// subject proves nothing, because its author writes it.

/** A commit's PR, and that PR's labels, among them the owner's growth approvals. */
export type Binding = { pr: number; labels: readonly string[] };

type Unreadable = { unreadable: string };

/** Each queue entry's head commit and PR; one query per run, so the answer must be whole. */
export const QUEUE_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    mergeQueue(branch: "main") {
      entries(first: 100) {
        totalCount
        nodes { headCommit { oid } pullRequest { number labels(first: 100) { totalCount nodes { name } } } }
      }
    }
  }
}`;

const labelsSchema = z.object({
  totalCount: z.number().int(),
  nodes: z.array(z.object({ name: z.string() })),
});

const queueSchema = z.object({
  data: z.object({
    repository: z.object({
      mergeQueue: z
        .object({
          entries: z.object({
            totalCount: z.number().int(),
            nodes: z.array(
              z.object({
                headCommit: z.object({ oid: z.string() }).nullable(),
                pullRequest: z
                  .object({ number: z.number().int().positive(), labels: labelsSchema })
                  .nullable(),
              }),
            ),
          }),
        })
        .nullable(),
    }),
  }),
});

const landedSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    merge_commit_sha: z.string().nullable(),
    merged_at: z.string().nullable(),
    labels: z.array(z.object({ name: z.string() })),
  }),
);

function parsedJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

/** The PR of each running queue entry by its head commit, or why the answer is not whole. */
export function queueBindings(answer: string): Map<string, Binding> | Unreadable {
  const parsed = queueSchema.safeParse(parsedJson(answer));
  if (!parsed.success) return { unreadable: 'The merge queue answer has an unexpected shape.' };
  const bindings = new Map<string, Binding>();
  const entries = parsed.data.data.repository.mergeQueue?.entries;
  if (!entries) return bindings;
  if (entries.totalCount > entries.nodes.length)
    return {
      unreadable: `The merge queue holds ${entries.totalCount} entries; one query reads ${entries.nodes.length}.`,
    };
  for (const { headCommit, pullRequest } of entries.nodes) {
    if (!headCommit || !pullRequest) continue;
    if (pullRequest.labels.totalCount > pullRequest.labels.nodes.length)
      return { unreadable: `The labels of #${pullRequest.number} do not fit one query.` };
    bindings.set(headCommit.oid, {
      pr: pullRequest.number,
      labels: pullRequest.labels.nodes.map((label) => label.name),
    });
  }
  return bindings;
}

/** The PR GitHub merged as exactly `commit`, a queue entry that landed during the run; undefined for none. */
export function landedBinding(answer: string, commit: string): Binding | undefined | Unreadable {
  const parsed = landedSchema.safeParse(parsedJson(answer));
  if (!parsed.success) return { unreadable: `The pull requests of ${commit} have an unexpected shape.` };
  const landed = parsed.data.find((pull) => pull.merged_at !== null && pull.merge_commit_sha === commit);
  return (
    landed && {
      pr: landed.number,
      labels: landed.labels.map((label) => label.name),
    }
  );
}

/**
 * The run's commits above `base`, newest first, from `git rev-list --parents --topo-order`, only when
 * each has exactly one parent: the commit below it, or `base` for the oldest. Then their changes are
 * the gate's whole range, and a merge cannot bring in a commit no queue entry names.
 */
export function commitLine(revList: string, base: string): string[] | Unreadable {
  const rows = revList
    .split('\n')
    .filter(Boolean)
    .map((row) => row.split(' '));
  const commits = rows.map(([commit = '']) => commit);
  for (const [index, [commit = '', ...parents]] of rows.entries()) {
    const below = commits[index + 1] ?? base;
    if (parents.length !== 1 || parents[0] !== below)
      return {
        unreadable: `${commit} has the parents ${parents.join(', ') || 'none'}; the queue's line needs ${below} alone.`,
      };
  }
  return commits;
}
