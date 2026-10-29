import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHANGED_CHECK_BASE, changedCheckPlan } from '../lib/testing/runner/changed-check';
import { enterHeavySlot } from '../lib/testing/runner/heavy-slot';

// `bun run check:changed`: the fast check an agent runs before it pushes
// (docs/technical/testing.md, "Run checks while you work"). It formats and
// lints the files that differ from the merge base, typechecks and looks for
// unused code across the repository, checks that an added migration sorts
// after main's newest, and runs the unit tests beside the changed files.
// Committed, uncommitted and untracked changes all count.
await enterHeavySlot('check:changed');
const repositoryRoot = resolve(import.meta.dir, '..');

function git(...args: string[]): string[] {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const [base] = git('merge-base', 'HEAD', CHANGED_CHECK_BASE);
if (!base) throw new Error(`No merge base with ${CHANGED_CHECK_BASE}; fetch it first.`);
const present = (file: string): boolean => existsSync(resolve(repositoryRoot, file));
const changed = [
  ...new Set([
    ...git('diff', '--name-only', '--no-renames', '--diff-filter=d', '-z', base, '--'),
    ...git('ls-files', '--others', '--exclude-standard', '-z'),
  ]),
].filter(present);
const plan = changedCheckPlan(changed, present);

type Outcome = { name: string; code: number; seconds: number; output: string };

function step(name: string, command: readonly string[]): Promise<Outcome> {
  const started = Date.now();
  const [executable, ...args] = command;
  if (!executable) throw new Error(`Step ${name} has no command.`);
  return new Promise((resolveStep, reject) => {
    const child = spawn(executable, args, { cwd: repositoryRoot, env: process.env });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) =>
      resolveStep({ name, code: code ?? 1, seconds: (Date.now() - started) / 1000, output }),
    );
  });
}

const bin = (tool: string): string => resolve(repositoryRoot, 'node_modules/.bin', tool);
const started = Date.now();
console.info(
  `[check:changed] ${changed.length} changed files since ${base.slice(0, 12)} (merge base with ${CHANGED_CHECK_BASE}); ${plan.unitTests.length} unit test files.`,
);
const outcomes = await Promise.all([
  plan.formatted.length
    ? step('format', [
        bin('prettier'),
        '--check',
        '--log-level',
        'warn',
        '--ignore-unknown',
        ...plan.formatted,
      ])
    : null,
  plan.linted.length
    ? step('lint', [bin('eslint'), '--max-warnings', '0', '--no-warn-ignored', ...plan.linted])
    : null,
  // The build info under node_modules/.cache makes a repeat typecheck re-read only what changed.
  step('typecheck', [
    'node',
    '--max-old-space-size=4096',
    resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--incremental',
    '--tsBuildInfoFile',
    resolve(repositoryRoot, 'node_modules/.cache/werkflow/check-changed.tsbuildinfo'),
  ]),
  step('unused', [bin('knip'), '--no-progress', '--cache']),
  step('migration order', [process.execPath, 'scripts/check-migration-order.ts']),
  plan.unitTests.length
    ? step('unit', [process.execPath, 'scripts/run-unit-tests.ts', ...plan.unitTests])
    : null,
]);
let failed = false;
for (const outcome of outcomes) {
  if (!outcome) continue;
  const passed = outcome.code === 0;
  failed ||= !passed;
  if (!passed) console.error(outcome.output.trim());
  console.info(
    `[check:changed] ${passed ? 'pass' : 'FAIL'} ${outcome.name} (${outcome.seconds.toFixed(1)} s)`,
  );
}
console.info(
  `[check:changed] ${failed ? 'failed' : 'passed'} in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
);
process.exitCode = failed ? 1 : 0;
