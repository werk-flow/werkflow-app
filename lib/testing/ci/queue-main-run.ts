// The run of main the merge queue owes after a landing (lib/testing/ci/queue.ts decides the landing;
// scripts/ci/queue.ts starts the run through its --main-runner).
import { z } from 'zod';
import type { QueueOutcome } from './queue';

/**
 * main's run a landing owes: the tick's base, main before the batch, the PRs it landed, the run's
 * id, which a retry keeps, so the run's claim on its commit stays its own, and the PR whose merge
 * the tick asked for last (`merging`): GitHub's word on it decides before the debt clears.
 */
export const mainFollowUpSchema = z
  .object({
    base: z.string().regex(/^[0-9a-f]{40}$/),
    prs: z.array(z.number().int().positive()),
    id: z.string().regex(/^[0-9A-Za-z-]+$/),
    merging: z.number().int().positive().nullable(),
  })
  .strict();
export type MainFollowUp = z.infer<typeof mainFollowUpSchema>;

/**
 * The main run a live tick owes when it landed a PR or stopped partway (`partial`), or undefined for
 * a dry run or a tick that moved nothing. `merging` is the PR whose merge the tick asked for last.
 * The queue saves it before it reads main, so a read that fails leaves it for the next tick.
 */
export function mainFollowUp(
  outcome: QueueOutcome,
  id: string,
  merging: number | null,
): MainFollowUp | undefined {
  const moved = outcome.landing.length > 0 || outcome.stops.some((stop) => stop.kind === 'partial');
  return !outcome.dryRun && moved
    ? { base: outcome.base, prs: [...outcome.landing], id, merging }
    : undefined;
}

/** GitHub's word on the merge a follow-up names: its merge commit, unmerged, or no answer. */
export type MergeAnswer = { merged: string } | { unmerged: true } | { unknown: string };

/**
 * main's run of its head for an owed follow-up: diffed against the tick's base, so it reuses the
 * batch's pass only for the landing the queue tested, and otherwise runs its jobs. Undefined when
 * the debt is clear: main did not move and GitHub reports the merge asked for last unmerged.
 * `unresolved` keeps it owed: GitHub gave no answer, or reports a merge main does not show yet.
 */
export function mainRunOf(
  followUp: MainFollowUp,
  head: string,
  merge: MergeAnswer,
): { commit: string; base: string; prs: number[]; id: string } | { unresolved: string } | undefined {
  const { merging, ...run } = followUp;
  if ('unknown' in merge)
    return {
      unresolved: `GitHub could not say whether #${merging} merged (${merge.unknown}), so main's run stays owed`,
    };
  if (head !== followUp.base) return { commit: head, ...run };
  return 'merged' in merge
    ? {
        unresolved: `GitHub reports #${merging} merged as ${merge.merged}, but main still reads ${head}, so main's run stays owed`,
      }
    : undefined;
}

/** The environment of main's run after a landing, on top of the runner's own. */
export function mainEnvironment(run: {
  commit: string;
  base: string;
  prs: readonly number[];
  runUrl: string;
  resultsDir: string;
}): Record<string, string> {
  return {
    CI_EVENT: 'main',
    CI_COMMIT: run.commit,
    CI_BASE_SHA: run.base,
    CI_RUN_URL: run.runUrl,
    CI_RESULTS_DIR: run.resultsDir,
    CI_PRS: run.prs.join(','),
  };
}
