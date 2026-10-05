import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureInputSnapshot, isDocumentationInput } from '../lib/testing/evidence/group-evidence';
import {
  publicationGateProblems,
  publicationReportSchema,
  REVIEW_RECORD_DIRECTORY,
  reviewRecordSchema,
  type ReviewRecord,
} from '../lib/testing/publication/publication-gate';

/**
 * The pre-push gate (.githooks/pre-push pipes git's ref list into this
 * script): exits 1 and prints what is missing unless the newest local
 * verification report passed on the tree being pushed and a CodeRabbit review
 * completed on it. It reads evidence only; the hook owns the owner override.
 */
const repository = resolve(import.meta.dir, '..');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function newestLocalReport(): ReturnType<typeof publicationReportSchema.parse> | undefined {
  const archive = resolve(repository, '.agent-logs/verification');
  if (!existsSync(archive)) return undefined;
  for (const directory of readdirSync(archive).sort().reverse()) {
    const file = resolve(archive, directory, 'report.json');
    if (!existsSync(file)) continue;
    const report = publicationReportSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (report.success && report.data.target === 'local') return report.data;
  }
  return undefined;
}

function reviewRecords(): ReviewRecord[] {
  const directory = resolve(repository, REVIEW_RECORD_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^[a-f0-9]{40}(-\d{8}T\d{9}Z)?\.json$/.test(name))
    .flatMap((name) => {
      const record = reviewRecordSchema.safeParse(JSON.parse(readFileSync(resolve(directory, name), 'utf8')));
      return record.success ? [record.data] : [];
    });
}

function knownCommit(commit: string): boolean {
  try {
    git('rev-parse', '--verify', '--quiet', `${commit}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

// Each line git writes to a pre-push hook: <local ref> <local sha> <remote ref> <remote sha>; a deletion pushes the zero id.
const isCommit = (commit: string | undefined): commit is string =>
  commit !== undefined && /^[a-f0-9]{40}$/.test(commit) && !/^0+$/.test(commit);
const updates = (await Bun.stdin.text())
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .flatMap(([, local, , remote]) => (isCommit(local) ? [{ local, remote }] : []));
const pushed = updates.map((update) => update.local);
// A new remote ref, or a remote commit this clone lacks, compares with production (or with nothing).
const fallbackBase = knownCommit('origin/main') ? 'origin/main' : '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const pushedFiles = updates.flatMap(({ local, remote }) =>
  git(
    'diff',
    '--name-only',
    '--no-renames',
    '--diff-filter=d',
    '-z',
    isCommit(remote) && knownCommit(remote) ? remote : fallbackBase,
    local,
    '--',
  ).split('\0'),
);
const uncommitted = [
  ...git('-c', 'core.safecrlf=false', 'diff', '--name-only', '-z', 'HEAD', '--').split('\0'),
  ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
].filter((file) => file && !isDocumentationInput(file));

const problems = publicationGateProblems({
  newestReport: newestLocalReport(),
  current: captureInputSnapshot(repository),
  uncommitted: [...new Set(uncommitted)].sort(),
  head: git('rev-parse', 'HEAD').trim(),
  pushed,
  pushedFiles: [...new Set(pushedFiles.filter(Boolean))].sort(),
  reviews: reviewRecords(),
});
if (problems.length) {
  console.error(`[publication-gate] Push refused; ${problems.length} requirement(s) missing:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '[publication-gate] Owner override: WERKFLOW_PUSH_OVERRIDE="<reason>" git push ... (logged to .agent-logs/review/overrides.log).',
  );
  process.exit(1);
}
console.log('[publication-gate] Verification report and CodeRabbit review cover this tree.');
