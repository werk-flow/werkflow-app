// A pull request's run that a newer push superseded proves nothing for the pull request, so a
// runner spends no more time on it (scripts/ci/job.ts). GitHub Actions cancels such a run through
// ci.yml's concurrency group; any runner that queues runs gives every job the PR's head ref instead.
import type { CiEvent } from './dag';

/**
 * The pull request's newer head when it moved past the head this run tests, or undefined: the run
 * is no pull request's own run, the runner names no head ref, or the remote cannot say. An
 * unanswered question runs the job, so a superseded run costs time but never passes anything.
 */
export function supersedingHead(input: {
  event: CiEvent;
  /** The ref on `origin` that holds the PR's current head, such as `refs/pull/568/head`. */
  headRef: string | undefined;
  /** The head commit this run tests. */
  testedHead: string;
  /** The commit `origin` holds at a ref, or undefined when it cannot say. */
  remoteHead: (ref: string) => string | undefined;
}): string | undefined {
  if (input.event !== 'pr' || !input.headRef) return undefined;
  const current = input.remoteHead(input.headRef);
  return current && current !== input.testedHead ? current : undefined;
}

/** The commit of one ref in `git ls-remote` output, or undefined when the output names none. */
export function lsRemoteCommit(output: string, ref: string): string | undefined {
  const line = output.split('\n').find((entry) => entry.split('\t')[1] === ref);
  const commit = line?.split('\t')[0];
  return commit && /^[0-9a-f]{40,64}$/.test(commit) ? commit : undefined;
}
