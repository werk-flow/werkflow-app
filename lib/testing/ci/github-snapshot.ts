// What a job in a container of the owner's machines reads of GitHub (lib/testing/ci/container-slot.ts):
// it holds no token, so the trusted side reads the PRs' labels and the open PRs' migrations with
// its own login and stages them as a file, named by WERKFLOW_GITHUB_SNAPSHOT. scripts/ci/prepare.ts
// (the list-growth approval) and scripts/check-migration-order.ts read the file when it is set and
// ask GitHub only without it, as on GitHub Actions.
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const SNAPSHOT_VARIABLE = 'WERKFLOW_GITHUB_SNAPSHOT';

const githubSnapshotSchema = z.strictObject({
  /** Each named PR's label names, by PR number. */
  labels: z.record(z.string().regex(/^[1-9][0-9]*$/), z.array(z.string())),
  /** The migrations the open PRs add; null when GitHub could not say (openPullRequestMigrations). */
  openMigrations: z
    .array(z.strictObject({ pullRequest: z.number().int().positive(), name: z.string().min(1) }))
    .nullable(),
});
export type GitHubSnapshot = z.infer<typeof githubSnapshotSchema>;

/**
 * The snapshot WERKFLOW_GITHUB_SNAPSHOT names, or undefined when it names none. A named file that
 * cannot be read or parsed throws: a job that was handed a snapshot never falls back to GitHub.
 */
export function snapshotOf(
  environment: Readonly<Record<string, string | undefined>>,
): GitHubSnapshot | undefined {
  const path = environment[SNAPSHOT_VARIABLE];
  if (!path) return undefined;
  return githubSnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** The PRs a queue commit's squash subjects name, `… (#123)`: an integration run takes their labels too. */
export function squashedPullRequests(subjects: string): number[] {
  return subjects
    .split('\n')
    .flatMap((subject) => /\(#([0-9]+)\)$/.exec(subject)?.[1] ?? [])
    .map(Number);
}
