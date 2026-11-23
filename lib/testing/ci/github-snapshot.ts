// What a job in a container of the owner's machines reads of GitHub (lib/testing/ci/container-slot.ts):
// it holds no token, so the trusted side stages a snapshot, named by WERKFLOW_GITHUB_SNAPSHOT: the
// list-growth approval the machine runner captured when it admitted the PR's head, and the open PRs'
// migrations. scripts/ci/prepare.ts takes the approval from it (never from labels or commit
// subjects), scripts/check-migration-order.ts the migrations; without it both ask GitHub, as on
// GitHub Actions.
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const SNAPSHOT_VARIABLE = 'WERKFLOW_GITHUB_SNAPSHOT';

const githubSnapshotSchema = z.strictObject({
  /** The owner's `approved: list growth` on the PR at the run's admission. */
  approved: z.boolean(),
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
