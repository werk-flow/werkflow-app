import { spawnSync } from 'node:child_process';

// A kept machine is wiped by origin/main's copy of the wipe script, never the branch's
// (docs/technical/boat-verification.md#machine-reuse). What a wipe must remove follows the snapshot
// and Boat's machine agent, which change outside any branch; a branch behind main would otherwise
// wipe with an old list, fail, and delete every machine it starts. The reuse decision itself stays
// the branch's code: it reads only the idle records and Boat's answers, which no outside change moves.

const WIPE_SCRIPT = 'scripts/boat/wipe-machine.sh';
/** A fetch that hangs must not hold a billed machine: past this, the wipe fails. */
const FETCH_TIMEOUT_MS = 30_000;

type Git = (args: readonly string[]) => { status: number | null; stdout: string; stderr: string };

const gitIn =
  (repository: string): Git =>
  (args) => {
    const result = spawnSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      timeout: FETCH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.error ? result.error.message : result.stderr,
    };
  };

/**
 * The text of origin/main's wipe script, after a fetch of main. A fetch or read that fails throws with
 * git's first line of complaint, so the caller deletes the machine, or starts none, and says why.
 */
export function mainWipeScript(repository: string, git: Git = gitIn(repository)): string {
  const run = (args: readonly string[]) => {
    const result = git(args);
    if (result.status === 0) return result.stdout;
    const complaint = result.stderr.trim().split('\n')[0] || `git ${args[0]} exited ${String(result.status)}`;
    throw new Error(`origin/main's wipe script cannot be read: ${complaint}`);
  };
  // An explicit refspec: a checkout whose fetch settings do not map main would otherwise leave origin/main stale.
  run(['fetch', '--quiet', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  return run(['show', `origin/main:${WIPE_SCRIPT}`]);
}
