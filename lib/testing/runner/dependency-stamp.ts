import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A worktree that merges `main` can get a `bun.lock` its `node_modules` was not installed from;
// a check then fails on a missing module in files the branch never touched. `bun install` stamps
// node_modules with the digest of the lockfile it installed (`postinstall`,
// scripts/stamp-dependencies.ts), and `check:changed`, `test:verify` and `test:plan` compare it
// first (scripts/require-installed-dependencies.ts) and name the cause and the command.

/** The digest of the `bun.lock` that `node_modules` was installed from; inside node_modules, so it goes with it. */
const STAMP = join('node_modules', '.werkflow-installed-bun-lock');

function lockDigest(repositoryRoot: string): string {
  return createHash('sha256')
    .update(readFileSync(join(repositoryRoot, 'bun.lock')))
    .digest('hex');
}

/** Records that `node_modules` now matches the current `bun.lock`. */
export function writeDependencyStamp(repositoryRoot: string): void {
  writeFileSync(join(repositoryRoot, STAMP), `${lockDigest(repositoryRoot)}\n`);
}

/** Why the installed dependencies may not match `bun.lock`, or undefined when they do. */
export function dependencyStampProblem(repositoryRoot: string): string | undefined {
  const stamp = join(repositoryRoot, STAMP);
  const installed = existsSync(stamp) ? readFileSync(stamp, 'utf8').trim() : undefined;
  if (installed === lockDigest(repositoryRoot)) return undefined;
  return `node_modules was not installed from this bun.lock${installed === undefined ? ' (no install stamp)' : ''}, so a check would fail on modules the change never touched. Run \`bun install --frozen-lockfile\`, then rerun.`;
}
