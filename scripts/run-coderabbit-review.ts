import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCodeRabbitReviewArguments,
  buildWindowsCodeRabbitCommand,
  CODERABBIT_WSL_BINARY,
  CODERABBIT_WSL_DISTRIBUTION,
  isStoredReviewCommand,
} from '../lib/testing/publication/coderabbit-review-command';
import { writeJsonAtomically } from '../lib/testing/runner/file-lock';
import { contentDigest } from '../lib/testing/evidence/source-content';
import {
  REVIEW_RECORD_DIRECTORY,
  reviewedFiles,
  reviewRecordSchema,
  reviewScope,
} from '../lib/testing/publication/publication-gate';

const rawArguments = process.argv.slice(2);
const doctorOnly = rawArguments.includes('--doctor');

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

const reviewExitCode = runCommand(
  buildWindowsCodeRabbitCommand({
    workingDirectory: process.cwd(),
    reviewArguments,
  }),
);
// A completed review of this tree is the evidence the pre-push gate reads (lib/testing/publication/publication-gate.ts).
if (reviewExitCode === 0 && !isStoredReviewCommand(rawArguments)) {
  const repository = resolve(import.meta.dir, '..');
  const git = (...args: string[]): string[] =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\0')
      .filter(Boolean);
  const head = git('rev-parse', 'HEAD')[0]?.trim() ?? fail('git rev-parse HEAD returned nothing.');
  // The files the review compared: commits after the base, or the working tree against it with untracked files.
  const scope = reviewScope(reviewArguments);
  const changed = scope.committedOnly
    ? git('diff', '--name-only', '--no-renames', '-z', scope.base, 'HEAD', '--')
    : [
        ...git('-c', 'core.safecrlf=false', 'diff', '--name-only', '--no-renames', '-z', scope.base, '--'),
        ...git('ls-files', '--others', '--exclude-standard', '-z'),
      ];
  const directory = resolve(repository, REVIEW_RECORD_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  // Directory passes of one tree each write their own record; the gate unites them.
  const recordName = `${head}-${new Date().toISOString().replace(/[-:.]/g, '')}.json`;
  writeJsonAtomically(
    resolve(directory, recordName),
    reviewRecordSchema.parse({
      version: 3,
      head,
      completedAt: new Date().toISOString(),
      arguments: reviewArguments,
      // Deleted files have no content to review and no digest.
      reviewedFiles: Object.fromEntries(
        reviewedFiles(changed, scope.directories)
          .filter((file) => existsSync(resolve(repository, file)))
          .map((file) => [file, contentDigest(file, readFileSync(resolve(repository, file)))]),
      ),
    }),
  );
  console.info(`[coderabbit-review] recorded ${REVIEW_RECORD_DIRECTORY}/${recordName}`);
}
process.exit(reviewExitCode);
