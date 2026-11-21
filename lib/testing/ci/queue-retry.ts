// The queue's retry before blame: a run without a verdict is retried once, on a later tick, and
// only the same work's second run without one needs a person. The record keeps every outstanding
// retry by its exact work until that work reaches a verdict or a tick settles, and every verdict its
// ticks reached, so a tree that answers otherwise on the same base later is still a contradiction.
import { z } from 'zod';
import type { BatchEntry, QueueOutcome, Verdict } from './queue';

/** The exact work a run tested: main before the batch, the PRs at their heads, and the tree. */
export type Work = { base: string; tree: string; pulls: { number: number; head: string }[] };

/** A verdict a run reached on a tree and base: a later run of them must agree with it. */
type Seen = { base: string; tree: string; kind: 'passed' | 'failed'; runUrl: string };

/** A run without a verdict whose work a later tick retries once. */
type Unanswered = Work & { runUrl: string; detail: string };

/** Every outstanding run without a verdict, one per work, and every verdict reached since the last clear. */
export type Retry = { unanswered: Unanswered[]; seen: Seen[] };

const sha = z.string().regex(/^[0-9a-f]{40}$/);

export const retrySchema = z
  .object({
    unanswered: z
      .array(
        z
          .object({
            runUrl: z.string().min(1),
            base: sha,
            tree: z.string().min(1),
            pulls: z.array(z.object({ number: z.number().int().positive(), head: sha }).strict()).min(1),
            detail: z.string(),
          })
          .strict(),
      )
      .min(1),
    seen: z.array(
      z
        .object({
          base: sha,
          tree: z.string().min(1),
          kind: z.enum(['passed', 'failed']),
          runUrl: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

/** The work of a prefix of the batch on `base`, whose tip has `tree`. */
export const workOf = (base: string, tree: string, prefix: readonly BatchEntry[]): Work => ({
  base,
  tree,
  pulls: prefix.map(({ pull }) => ({ number: pull.number, head: pull.headSha })),
});

const sameWork = (left: Work, right: Work): boolean =>
  left.base === right.base &&
  left.tree === right.tree &&
  left.pulls.length === right.pulls.length &&
  left.pulls.every(
    (pull, index) => pull.number === right.pulls[index]?.number && pull.head === right.pulls[index]?.head,
  );

/** The verdicts the tick's runs reached, on its base. */
const seenIn = (outcome: QueueOutcome): Seen[] =>
  outcome.runs.flatMap(({ tree, verdict }) =>
    verdict.kind === 'inconclusive'
      ? []
      : [{ base: outcome.base, tree, kind: verdict.kind, runUrl: verdict.runUrl }],
  );

/**
 * An earlier verdict on the work's tree and base that the run's verdict contradicts. A PR that
 * repeats changes already in the batch keeps the tree; a second run of a tree that answers
 * otherwise, in this tick or the ticks its retry record covers, is a flake and proves neither
 * answer. A run without a verdict contradicts nothing.
 */
export const contradiction = (
  work: Work,
  verdict: Verdict,
  outcome: QueueOutcome,
  retry: Retry | null | undefined,
): Seen | undefined =>
  verdict.kind === 'inconclusive'
    ? undefined
    : [...(retry?.seen ?? []), ...seenIn(outcome)].find(
        (seen) => seen.base === work.base && seen.tree === work.tree && seen.kind !== verdict.kind,
      );

/**
 * The record after a run of `work` without a verdict: every other outstanding retry stays unless
 * its work reached a verdict in this tick (`answered`), and the tick's verdicts join the earlier ones.
 */
export const retryOf = (
  work: Work,
  verdict: Verdict,
  outcome: QueueOutcome,
  earlier: Retry | null | undefined,
  answered: readonly Work[],
): Retry => ({
  unanswered: [
    ...(earlier?.unanswered ?? []).filter((entry) => !answered.some((done) => sameWork(done, entry))),
    { ...work, runUrl: verdict.runUrl, detail: verdict.detail },
  ],
  seen: [...(earlier?.seen ?? []), ...seenIn(outcome)],
});

/**
 * A run without a verdict: retried live unless the record holds this work's own retry; else for a
 * person (a dry run: `retry` undefined).
 */
export function noVerdict(
  work: Work,
  verdict: Verdict,
  contradicted: Seen | undefined,
  retry: Retry | null | undefined,
): QueueOutcome['stops'][number] {
  if (contradicted)
    return {
      kind: 'inconclusive',
      detail: `tree ${work.tree} ${contradicted.kind} in ${contradicted.runUrl} but ${verdict.kind} in ${verdict.runUrl}`,
    };
  const detail = `${verdict.runUrl}: ${verdict.detail}`;
  if (retry === undefined) return { kind: 'inconclusive', detail };
  const earlier = retry?.unanswered.find((entry) => sameWork(entry, work));
  if (!earlier) return { kind: 'retry', detail };
  return {
    kind: 'inconclusive',
    detail: `${detail}, after the retry of ${earlier.runUrl} (${earlier.detail})`,
  };
}
