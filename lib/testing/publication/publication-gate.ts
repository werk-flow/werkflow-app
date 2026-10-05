import { z } from 'zod';
import {
  changedInputs,
  inputSnapshotSchema,
  isDocumentationInput,
  type InputSnapshot,
} from '../evidence/group-evidence';

/**
 * The one gate before publication (decision 0007, amendment 2026-10-01): a
 * push needs a passing automatic verification report and completed CodeRabbit
 * reviews, both on the source tree being pushed, and the reviews together cover
 * every changed file the push adds or modifies. The pre-push hook
 * (.githooks/pre-push) runs scripts/check-publication-gate.ts, which reads the
 * evidence and calls `publicationGateProblems`.
 */
export const REVIEW_RECORD_DIRECTORY = '.agent-logs/review';

/**
 * Version 3 records the content digest of every file the review covered, so a
 * directory pass stays valid for its files until one of them changes; an older
 * record does not parse and needs a new review.
 */
export const reviewRecordSchema = z.object({
  version: z.literal(3),
  /** HEAD when the review completed; the first part of the record's file name. */
  head: z.string().regex(/^[a-f0-9]{40}$/),
  completedAt: z.string().datetime(),
  arguments: z.array(z.string()),
  /** Repository-relative path to the content digest of each changed file in the review's scope. */
  reviewedFiles: z.record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

/** What a review compares, read from its CodeRabbit arguments. */
export type ReviewScope = {
  /** The comparison base; HEAD when the arguments name none. */
  base: string;
  /** `--committed`: only commits after the base, not the working tree. */
  committedOnly: boolean;
  /** `--dir` values as repository-relative folders; empty means the whole repository. */
  directories: string[];
};

function optionValues(reviewArguments: readonly string[], names: readonly string[]): string[] {
  return reviewArguments.flatMap((argument, index) => {
    const [name, ...inline] = argument.split('=');
    if (name === undefined || !names.includes(name)) return [];
    const value = inline.length ? inline.join('=') : reviewArguments[index + 1];
    return value === undefined ? [] : [value];
  });
}

export function reviewScope(reviewArguments: readonly string[]): ReviewScope {
  return {
    base: optionValues(reviewArguments, ['--base-commit', '--base']).at(-1) ?? 'HEAD',
    committedOnly: reviewArguments.includes('--committed'),
    directories: optionValues(reviewArguments, ['--dir']).map((directory) =>
      directory
        .replace(/\\/g, '/')
        // Only a `./` prefix or a bare `.` is the current folder; `.githooks` keeps its dot.
        .replace(/^\.(?:\/|$)/, '')
        .replace(/\/+$/, ''),
    ),
  };
}

/** The changed files a review covered: all of them, or those under one of its `--dir` folders. */
export function reviewedFiles(changed: readonly string[], directories: readonly string[]): string[] {
  const inScope = (file: string): boolean =>
    directories.length === 0 ||
    directories.some(
      (directory) => directory === '' || file === directory || file.startsWith(`${directory}/`),
    );
  return [...new Set(changed.filter(inScope))].sort();
}

export const publicationReportSchema = z.object({
  id: z.string(),
  target: z.enum(['local', 'cloud']),
  status: z.enum(['running', 'passed', 'failed']),
  scope: z.enum(['selected-groups', 'all-required-groups']),
  snapshot: inputSnapshotSchema,
});
type PublicationReport = z.infer<typeof publicationReportSchema>;

function sample(files: readonly string[]): string {
  return `${files.slice(0, 5).join(', ')}${files.length > 5 ? `, and ${files.length - 5} more` : ''}`;
}

/** Every missing piece of publication evidence, each with the command that produces it. */
export function publicationGateProblems(input: {
  /** The newest verification report of the local target, if any. */
  newestReport: PublicationReport | undefined;
  current: InputSnapshot;
  /** Input files that differ from HEAD or are untracked. */
  uncommitted: readonly string[];
  head: string;
  /** Commits this push publishes; deletions are not listed. */
  pushed: readonly string[];
  /** Files the push adds or modifies since the remote state; deleted files are not listed. */
  pushedFiles: readonly string[];
  reviews: readonly ReviewRecord[];
}): string[] {
  const problems: string[] = [];
  const foreign = input.pushed.filter((commit) => commit !== input.head);
  if (foreign.length)
    problems.push(
      `The push publishes ${sample(foreign)}, not the checked-out commit ${input.head}. The evidence covers the working tree only: check out the commit you publish, then verify and review it.`,
    );
  if (input.uncommitted.length)
    problems.push(
      `Uncommitted changes in ${input.uncommitted.length} input file(s): ${sample(input.uncommitted)}. The evidence covers the working tree, the push publishes HEAD: commit the changes first.`,
    );
  const report = input.newestReport;
  if (!report) {
    problems.push(
      'No local verification report exists. Run: bun run test:server local (own terminal), then bun run test:verify',
    );
  } else if (report.status !== 'passed' || report.scope !== 'all-required-groups') {
    problems.push(
      `The newest verification report ${report.id} is ${report.status === 'passed' ? 'an explicit --group run' : report.status}. Run: bun run test:verify (without --group) until it passes.`,
    );
  } else {
    const drift = changedInputs(
      { ...report.snapshot, environment: input.current.environment },
      input.current,
    );
    if (drift.length)
      problems.push(
        `Verification report ${report.id} passed on a different tree; ${drift.length} file(s) changed since: ${sample(drift)}. Run: bun run test:verify`,
      );
  }
  // A file counts as reviewed while its content equals what a completed review saw;
  // a file without a current digest has no content a review can match.
  const reviewed = (file: string): boolean => {
    const digest = input.current.files[file];
    return digest !== undefined && input.reviews.some((review) => review.reviewedFiles[file] === digest);
  };
  const unreviewed = input.pushedFiles.filter((file) => !isDocumentationInput(file) && !reviewed(file));
  if (unreviewed.length)
    problems.push(
      `No completed CodeRabbit review covers ${unreviewed.length} changed file(s) as they are now: ${sample(unreviewed)}. Run: bun run review --base-commit <last published commit> (or bun run review before committing, with --dir for a part), resolve its findings, and review again after a change; a completed review writes ${REVIEW_RECORD_DIRECTORY}/<HEAD sha>-<time>.json.`,
    );
  return problems;
}
