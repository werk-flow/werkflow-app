import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildCodeRabbitReviewArguments,
  buildWindowsCodeRabbitCommand,
  CODERABBIT_WSL_BINARY,
  CODERABBIT_WSL_DISTRIBUTION,
  isStoredReviewCommand,
  untrackedScopeProblem,
  wslGitEnvironment,
} from '../lib/testing/publication/coderabbit-review-command';
import { writeJsonAtomically } from '../lib/testing/runner/file-lock';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { recordEvidence } from '../lib/testing/publication/evidence-ledger';
import {
  REVIEW_RECORD_DIRECTORY,
  reviewDigests,
  reviewRecordSchema,
  reviewScope,
  type ReviewScope,
} from '../lib/testing/publication/publication-gate';

const rawArguments = process.argv.slice(2);
const doctorOnly = rawArguments.includes('--doctor');
const repository = resolve(import.meta.dir, '..');

function runCommand(command: readonly string[]): number {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return result.exitCode;
}

function fail(message: string): never {
  console.error(`[coderabbit-review] ${message}`);
  process.exit(1);
}

function git(...args: string[]): string[] {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function committedContent(file: string): Buffer | undefined {
  try {
    return execFileSync('git', ['show', `HEAD:${file}`], { cwd: repository, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    // git show exits 128 for a file HEAD does not hold (deleted in the reviewed commits).
    return undefined;
  }
}

/** The digests of the files the review compares, read now: before CodeRabbit starts, or after it to compare. */
function scopeDigests(scope: ReviewScope): Record<string, string> {
  // The files the review compared: commits after the base, or the working tree against it with untracked files.
  const changed = scope.committedOnly
    ? git('diff', '--name-only', '--no-renames', '-z', scope.base, 'HEAD', '--')
    : [
        ...git('-c', 'core.safecrlf=false', 'diff', '--name-only', '--no-renames', '-z', scope.base, '--'),
        ...git('ls-files', '--others', '--exclude-standard', '-z'),
      ];
  return reviewDigests({
    changed,
    scope,
    readWorkingTree: (file) =>
      existsSync(resolve(repository, file)) ? readFileSync(resolve(repository, file)) : undefined,
    readCommitted: committedContent,
  });
}

if (process.platform !== 'win32') {
  fail('This repository command currently supports the configured Windows and WSL workstation only.');
}

const binaryCheckExitCode = runCommand([
  'wsl.exe',
  '--distribution',
  CODERABBIT_WSL_DISTRIBUTION,
  '--exec',
  '/usr/bin/test',
  '-x',
  CODERABBIT_WSL_BINARY,
]);
if (binaryCheckExitCode !== 0) {
  fail(
    `${CODERABBIT_WSL_BINARY} is missing or not executable. Do not install or reinstall CodeRabbit. Report this host problem to the owner.`,
  );
}

const authExitCode = runCommand([
  'wsl.exe',
  '--distribution',
  CODERABBIT_WSL_DISTRIBUTION,
  '--exec',
  CODERABBIT_WSL_BINARY,
  'auth',
  'status',
  '--agent',
]);
if (authExitCode !== 0) {
  fail(
    'CodeRabbit is installed but not authenticated. Ask the owner to restore authentication. Do not install or reinstall the CLI.',
  );
}

if (doctorOnly) {
  console.info(`[coderabbit-review] ready: ${CODERABBIT_WSL_BINARY} in ${CODERABBIT_WSL_DISTRIBUTION}`);
  process.exit(0);
}

let reviewArguments: string[];
try {
  reviewArguments = buildCodeRabbitReviewArguments(rawArguments);
} catch (error) {
  fail(error instanceof Error ? error.message : 'Invalid review arguments.');
}
/** The global ignore file git reads on Windows: core.excludesFile, else the XDG default, when it exists. */
function windowsExcludesFile(): string | null {
  let configured = '';
  try {
    configured = execFileSync('git', ['config', '--path', 'core.excludesFile'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
  } catch {
    // git config exits 1 when the key is unset; the XDG default applies then.
  }
  const home = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config');
  const candidate = configured || resolve(home, 'git', 'ignore');
  return existsSync(candidate) ? resolve(candidate) : null;
}

/** The untracked files git in WSL lists with the same ignore sources, as CodeRabbit collects them. */
function wslUntrackedFiles(excludesFile: string | null): string[] {
  return execFileSync(
    'wsl.exe',
    [
      '--distribution',
      CODERABBIT_WSL_DISTRIBUTION,
      '--cd',
      repository,
      '--exec',
      ...wslGitEnvironment(excludesFile),
      'git',
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
}

const excludesFile = windowsExcludesFile();
const command = buildWindowsCodeRabbitCommand({
  workingDirectory: process.cwd(),
  reviewArguments,
  windowsExcludesFile: excludesFile,
});

// Replaying stored findings reviews nothing and certifies nothing.
if (isStoredReviewCommand(rawArguments)) process.exit(runCommand(command));

// A completed review of this tree is the evidence the pre-push gate reads (lib/testing/publication/publication-gate.ts).
// The workspace lock keeps agents from editing a file while CodeRabbit reads it (the edit guard), and the
// digests are taken before the review starts, so the record certifies exactly what CodeRabbit saw.
// Inside the lock a failure throws, so the lock is released before the process exits.
const reviewUnderLock = withWorkspaceTestLock(
  { operation: 'CodeRabbit review', repositoryRoot: repository },
  async () => {
    const head = git('rev-parse', 'HEAD')[0]?.trim();
    if (!head) throw new Error('git rev-parse HEAD returned nothing.');
    const scope = reviewScope(reviewArguments);
    if (!scope.committedOnly) {
      const problem = untrackedScopeProblem(
        git('ls-files', '--others', '--exclude-standard', '-z'),
        wslUntrackedFiles(excludesFile),
      );
      if (problem) throw new Error(problem);
    }
    const before = scopeDigests(scope);
    const reviewExitCode = runCommand(command);
    if (reviewExitCode !== 0) return reviewExitCode;
    const after = scopeDigests(scope);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
      (file) => before[file] !== after[file],
    );
    if (git('rev-parse', 'HEAD')[0]?.trim() !== head || changed.length)
      throw new Error(
        `The reviewed content changed while CodeRabbit ran (${changed.slice(0, 5).join(', ') || 'HEAD moved'}); no review record was written. Review again.`,
      );
    mkdirSync(resolve(repository, REVIEW_RECORD_DIRECTORY), { recursive: true });
    // Directory passes of one tree each write their own record; the gate unites them.
    const recordPath = `${REVIEW_RECORD_DIRECTORY}/${head}-${new Date().toISOString().replace(/[-:.]/g, '')}.json`;
    writeJsonAtomically(
      resolve(repository, recordPath),
      reviewRecordSchema.parse({
        version: 3,
        head,
        completedAt: new Date().toISOString(),
        arguments: reviewArguments,
        reviewedFiles: before,
      }),
    );
    recordEvidence(repository, recordPath, 'CodeRabbit review record');
    console.info(`[coderabbit-review] recorded ${recordPath}`);
    return 0;
  },
);
try {
  process.exit(await reviewUnderLock);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
