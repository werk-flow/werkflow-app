import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  captureInputSnapshot,
  isDocumentationInput,
  type InputSnapshot,
} from '../lib/testing/evidence/group-evidence';
import { deletionPassProblems, parsePublishedCommits } from '../lib/testing/publication/deletion-pass';
import { readRepositoryLedger, recordedEvidence } from '../lib/testing/publication/evidence-ledger';
import {
  measuredPassReportSchema,
  publicationGateProblems,
  publicationReportSchema,
  REVIEW_RECORD_DIRECTORY,
  reviewRecordSchema,
  type ReviewRecord,
} from '../lib/testing/publication/publication-gate';
import {
  EMPTY_TREE,
  parsePushUpdates,
  publishesProduction,
  pushDiffBase,
} from '../lib/testing/publication/push-refs';
import { committedFileText, shrinkOnlyProblems } from '../lib/testing/publication/shrink-only-lists';
import { measuredGroupsForChange } from '../lib/testing/selection/group-selection';
import { getTestGroups } from '../lib/testing/selection/test-groups';

/**
 * The pre-push gate (.githooks/pre-push pipes git's ref list into this
 * script): exits 1 and prints what is missing unless the newest local
 * verification report passed on the tree being pushed, every wall-clock group
 * that measures a pushed product file passed on its current content, a
 * CodeRabbit review completed on it, and every commit the push publishes
 * records its deletion pass, and no shrink-only list grew against the commit the
 * push replaces. A push to main also needs a release plan and the
 * cloud canary. It trusts only evidence whose content the evidence ledger
 * records (lib/testing/publication/evidence-ledger.ts). It reads evidence
 * only; the hook owns the owner override.
 */
const repository = resolve(import.meta.dir, '..');
const ledger = readRepositoryLedger(repository);
const VERIFICATION_DIRECTORY = '.agent-logs/verification';

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

/** The text of a ledger-recorded evidence file, or undefined for a missing or unrecorded one. */
function recordedText(relativePath: string): string | undefined {
  const file = resolve(repository, relativePath);
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  return recordedEvidence(ledger, relativePath, bytes) ? bytes.toString('utf8') : undefined;
}

function reportDirectories(): string[] {
  const archive = resolve(repository, VERIFICATION_DIRECTORY);
  return existsSync(archive) ? readdirSync(archive).sort().reverse() : [];
}

function newestReport(
  target: 'local' | 'cloud',
): ReturnType<typeof publicationReportSchema.parse> | undefined {
  for (const directory of reportDirectories()) {
    const text = recordedText(`${VERIFICATION_DIRECTORY}/${directory}/report.json`);
    if (!text) continue;
    const report = publicationReportSchema.safeParse(JSON.parse(text));
    if (report.success && report.data.target === target) return report.data;
  }
  return undefined;
}

/** The passing local runs of the named wall-clock groups, each with the snapshot of its report. */
function measuredPasses(groupIds: ReadonlySet<string>): { groupId: string; snapshot: InputSnapshot }[] {
  if (!groupIds.size) return [];
  return reportDirectories().flatMap((directory) => {
    const text = recordedText(`${VERIFICATION_DIRECTORY}/${directory}/report.json`);
    if (!text || ![...groupIds].some((groupId) => text.includes(`"${groupId}"`))) return [];
    const report = measuredPassReportSchema.safeParse(JSON.parse(text));
    if (!report.success || report.data.target !== 'local') return [];
    return report.data.results
      .filter((result) => result.status === 'passed' && groupIds.has(result.groupId))
      .map((result) => ({ groupId: result.groupId, snapshot: report.data.snapshot }));
  });
}

function reviewRecords(): ReviewRecord[] {
  const directory = resolve(repository, REVIEW_RECORD_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^[a-f0-9]{40}(-\d{8}T\d{9}Z)?\.json$/.test(name))
    .flatMap((name) => {
      const text = recordedText(`${REVIEW_RECORD_DIRECTORY}/${name}`);
      const record = text ? reviewRecordSchema.safeParse(JSON.parse(text)) : undefined;
      return record?.success ? [record.data] : [];
    });
}

function knownCommit(commit: string): boolean {
  try {
    git('rev-parse', '--verify', '--quiet', `${commit}^{commit}`);
    return true;
  } catch {
    // rev-parse exits 1 for a commit this clone lacks.
    return false;
  }
}

const updates = parsePushUpdates(await Bun.stdin.text());
const pushed = updates.map((update) => update.local);
const pushedFiles = updates.flatMap((update) =>
  git(
    'diff',
    '--name-only',
    '--no-renames',
    '--diff-filter=d',
    '-z',
    pushDiffBase(update, knownCommit),
    update.local,
    '--',
  ).split('\0'),
);
const uncommitted = [
  ...git('-c', 'core.safecrlf=false', 'diff', '--name-only', '-z', 'HEAD', '--').split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
].filter((file) => file && !isDocumentationInput(file));

// The commits this push publishes: reachable from a pushed commit, on no remote yet.
const publishedCommits = parsePublishedCommits(
  pushed.length
    ? git('log', '--no-merges', '--format=%H%x00%B%x1e', ...pushed, '--not', '--remotes', '--')
    : '',
);

const publishedFiles = [...new Set(pushedFiles.filter(Boolean))].sort();
const measuredGroups = measuredGroupsForChange(getTestGroups(repository), publishedFiles);
const problems = [
  ...(ledger.problems.length
    ? [
        `The evidence ledger is broken (${ledger.problems.join('; ')}); no report or review counts. Report it to the owner.`,
      ]
    : []),
  ...publicationGateProblems({
    newestReport: newestReport('local'),
    current: captureInputSnapshot(repository),
    uncommitted: [...new Set(uncommitted)].sort(),
    head: git('rev-parse', 'HEAD').trim(),
    pushed,
    pushedFiles: publishedFiles,
    reviews: reviewRecords(),
    measuredGroups,
    measuredPasses: measuredPasses(new Set(measuredGroups.map((group) => group.id))),
    production: publishesProduction(updates),
    canaryReport: newestReport('cloud'),
  }),
  ...deletionPassProblems(publishedCommits),
  // A shrink-only list never grows against the commit the push replaces.
  ...updates.flatMap((update) => {
    const base = pushDiffBase(update, knownCommit);
    return base === EMPTY_TREE
      ? []
      : shrinkOnlyProblems(
          (file) => committedFileText(repository, base, file),
          (file) => committedFileText(repository, update.local, file),
        );
  }),
];
if (problems.length) {
  console.error(`[publication-gate] Push refused; ${problems.length} requirement(s) missing:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '[publication-gate] Owner override: WERKFLOW_PUSH_OVERRIDE="<reason>" git push ... (logged to .agent-logs/review/overrides.log).',
  );
  process.exit(1);
}
console.log(
  '[publication-gate] Verification report and CodeRabbit review cover this tree; every published commit records its deletion pass.',
);
