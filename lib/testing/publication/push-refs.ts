import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * What a push publishes, read from the lines git writes to a pre-push hook:
 * `<local ref> <local sha> <remote ref> <remote sha>`. scripts/check-publication-gate.ts
 * reads its standard input through these functions.
 */
export type PushUpdate = {
  localRef: string;
  local: string;
  remoteRef: string;
  /** The remote's current commit, or undefined for a new remote ref. */
  remote: string | undefined;
};

/** The empty tree: the diff base of a first push into an empty repository. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The branch whose remote ref is production; every other ref is a preview (decision 0008). */
const PRODUCTION_REF = 'refs/heads/main';

function isCommitId(value: string | undefined): value is string {
  return value !== undefined && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
}

/** Every pushed update; a deletion (zero local id) publishes nothing and is left out. */
export function parsePushUpdates(stdin: string): PushUpdate[] {
  return stdin
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([localRef, local, remoteRef, remote]) =>
      isCommitId(local) && localRef && remoteRef
        ? [{ localRef, local, remoteRef, remote: isCommitId(remote) ? remote : undefined }]
        : [],
    );
}

/**
 * The commit the pushed files are compared with: the remote's commit when this clone has it;
 * otherwise production (`origin/main`) when known, so a new branch or a remote commit this clone
 * lacks is compared with what production holds; otherwise the empty tree.
 */
export function pushDiffBase(update: PushUpdate, knownCommit: (commit: string) => boolean): string {
  if (update.remote && knownCommit(update.remote)) return update.remote;
  return knownCommit('origin/main') ? 'origin/main' : EMPTY_TREE;
}

/** True when any update publishes to production. */
export function publishesProduction(updates: readonly PushUpdate[]): boolean {
  return updates.some((update) => update.remoteRef === PRODUCTION_REF);
}

/** This clone's `core.hooksPath`, or undefined when git has none configured. */
export function configuredHooksPath(repositoryRoot: string): string | undefined {
  try {
    return execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim();
  } catch {
    // git config exits 1 when the key is unset.
    return undefined;
  }
}

/**
 * The publication gate exists only while git runs `.githooks/pre-push`, which it does only when
 * `core.hooksPath` names that folder (a fresh clone has no such setting). `bun run test:verify` and
 * `bun run docs:check` refuse while it is missing (audit finding B6, 2026-10-16).
 */
export function hooksPathProblem(configured: string | undefined, repositoryRoot: string): string | undefined {
  // Git resolves a relative value against the working tree; this clone may also hold the absolute path.
  // Windows and macOS compare paths without case; Linux does not.
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  const comparable = (path: string): string => {
    const normalized = resolve(repositoryRoot, path).replace(/\\/g, '/').replace(/\/+$/, '');
    return caseless ? normalized.toLowerCase() : normalized;
  };
  if (configured?.trim() && comparable(configured.trim()) === comparable('.githooks')) return undefined;
  return `git config core.hooksPath is ${configured?.trim() ? `"${configured.trim()}"` : 'unset'}, so git never runs the publication gate (.githooks/pre-push). Run once in this clone: git config core.hooksPath .githooks`;
}
