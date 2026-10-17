import { z } from 'zod';
import {
  changedInputs,
  inputSnapshotSchema,
  isDocumentationInput,
  type InputSnapshot,
} from '../evidence/group-evidence';
import { contentDigest } from '../evidence/source-content';

/**
 * The one gate before publication (decision 0007, amendment 2026-10-01): a
 * push needs a passing automatic verification report and completed CodeRabbit
 * reviews, both on the source tree being pushed, and the reviews together cover
 * every changed file the push adds or modifies. A pushed product file that a
 * wall-clock group measures also needs a passing run of that group on its
 * current content. The pre-push hook
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

/**
 * The content digests a review record certifies, taken before CodeRabbit starts: for
 * `--committed` the content at HEAD (the scope is base..HEAD), otherwise the working tree.
 * Until 2026-10-16 the wrapper read the working tree after the review, so an edit during the
 * review, or an uncommitted edit beside a committed review, was certified unseen (audit finding B8).
 * A file without content (deleted) has no digest.
 */
export function reviewDigests(input: {
  changed: readonly string[];
  scope: ReviewScope;
  readWorkingTree: (file: string) => Buffer | undefined;
  readCommitted: (file: string) => Buffer | undefined;
}): Record<string, string> {
  const read = input.scope.committedOnly ? input.readCommitted : input.readWorkingTree;
  return Object.fromEntries(
    reviewedFiles(input.changed, input.scope.directories).flatMap((file) => {
      const contents = read(file);
      return contents === undefined ? [] : [[file, contentDigest(file, contents)]];
    }),
  );
}

export const publicationReportSchema = z.object({
  id: z.string(),
  mode: z.enum(['change', 'release']),
  target: z.enum(['local', 'cloud']),
  status: z.enum(['running', 'passed', 'failed']),
  scope: z.enum(['selected-groups', 'all-required-groups']),
  snapshot: inputSnapshotSchema,
});
type PublicationReport = z.infer<typeof publicationReportSchema>;

/** A verification report with its group results, read for the passes of the wall-clock groups. */
export const measuredPassReportSchema = publicationReportSchema.extend({
  results: z.array(z.object({ groupId: z.string(), status: z.string() })),
});

/** A passing run of a wall-clock group, with the input snapshot of its report. */
type MeasuredPass = { groupId: string; snapshot: InputSnapshot };

/**
 * A change plan never runs the wall-clock groups (`measuredGroupsForChange`),
 * so a push of a product file one of them measures needs a passing run of that
 * group on the file's current content. Any run of such a group enforces its
 * deadlines: an explicit `--group` or a release plan.
 */
function measuredGroupProblems(input: {
  current: InputSnapshot;
  measuredGroups: readonly { id: string; changedFiles: readonly string[] }[];
  measuredPasses: readonly MeasuredPass[];
}): string[] {
  return input.measuredGroups.flatMap((group) => {
    const covered = input.measuredPasses.some(
      (pass) =>
        pass.groupId === group.id &&
        group.changedFiles.every(
          (file) =>
            input.current.files[file] !== undefined &&
            pass.snapshot.files[file] === input.current.files[file],
        ),
    );
    return covered
      ? []
      : [
          `${group.id} measures ${group.changedFiles.length} pushed product file(s) whose current content no passing run of it saw: ${sample(group.changedFiles)}. A change plan never runs it. On a quiet machine run: bun run test:server local (own terminal), then bun run test:verify --group ${group.id}`,
        ];
  });
}

/**
 * A push to production (`refs/heads/main`) needs the release evidence of testing.md: the newest
 * local report is a passing release plan, and the newest cloud report is a passing canary, both on
 * the pushed tree. Until 2026-10-16 the gate read no remote ref, and a change plan let a push to
 * main through (audit finding B9).
 */
function productionProblems(input: {
  newestReport: PublicationReport | undefined;
  canaryReport: PublicationReport | undefined;
  current: InputSnapshot;
}): string[] {
  const problems: string[] = [];
  if (input.newestReport?.mode !== 'release')
    problems.push(
      `A push to main publishes production and needs a passing release plan as the newest local report${input.newestReport ? `; ${input.newestReport.id} is a ${input.newestReport.mode} plan` : ''}. Run: bun run test:verify --mode release`,
    );
  const canary = input.canaryReport;
  const canaryDrift = canary
    ? changedInputs({ ...canary.snapshot, environment: input.current.environment }, input.current)
    : [];
  if (!canary || canary.status !== 'passed' || canary.scope !== 'all-required-groups')
    problems.push(
      `A push to main needs a passing cloud canary${canary ? `; the newest cloud report ${canary.id} is ${canary.status === 'passed' ? 'an explicit --group run' : canary.status}` : ''}. Run: bun run env:dev, bun run test:server cloud (own terminal), bun run test:verify --target cloud, then bun run env:local`,
    );
  else if (canaryDrift.length)
    problems.push(
      `Cloud canary ${canary.id} passed on a different tree; ${canaryDrift.length} file(s) changed since: ${sample(canaryDrift)}. Run the canary again on this tree.`,
    );
  return problems;
}

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
  /** The wall-clock groups whose scopes own a pushed product file (`measuredGroupsForChange`). */
  measuredGroups: readonly { id: string; changedFiles: readonly string[] }[];
  /** The passing local runs of those groups. */
  measuredPasses: readonly MeasuredPass[];
  /** True when the push updates production (`publishesProduction`). */
  production: boolean;
  /** The newest verification report of the cloud target: the canary. */
  canaryReport: PublicationReport | undefined;
}): string[] {
  const problems: string[] = [];
  if (input.production) problems.push(...productionProblems(input));
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
  problems.push(...measuredGroupProblems(input));
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
