import { resolve } from 'node:path';
import {
  migrationOrderProblems,
  openPullRequestMigrations,
} from '../lib/testing/local-stack/migration-order';
import { CHANGED_CHECK_BASE } from '../lib/testing/runner/changed-check';

// `bun run migrations:order`: static gate static:migration-order, also a step of `check:changed`.
// CI checks out a pull request as its merge commit and a merge-queue entry as its commit on top of
// the entries ahead of it, so there the first parent is the main the migration lands on. Another CI
// runner's job sets CI_BASE_SHA to the landing base its plan recorded (scripts/ci/job.ts).
const repositoryRoot = resolve(import.meta.dir, '..');
const mainRef =
  process.env.GITHUB_ACTIONS === 'true' ? 'HEAD^1' : process.env.CI_BASE_SHA || CHANGED_CHECK_BASE;
const openPullRequests = openPullRequestMigrations(repositoryRoot);
// The open pull requests only warn early: main's history, which the merge queue checks, holds the
// version of every pull request merged or queued before this one.
if (openPullRequests === null)
  console.warn(
    '[migrations:order] GitHub could not be read, so no open pull request was checked for a duplicate version.',
  );
const problems = migrationOrderProblems({ repositoryRoot, mainRef, openPullRequests });
for (const problem of problems) console.error(problem);
if (!problems.length)
  console.info(
    `[migrations:order] No added migration repeats a version or changes what a newer migration on ${mainRef} changes.`,
  );
process.exitCode = problems.length ? 1 : 0;
