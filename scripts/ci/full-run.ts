import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type FullRun,
  fullRunDue,
  fullRunsInLedger,
  type Landed,
  MAIN_HISTORY_DEPTH,
} from '../../lib/testing/ci/full-run';
import { readLedger } from '../../lib/testing/ci/results';
import { isDocsFile, tailwindScan } from '../../lib/testing/selection/fast-tier';

// Whether main's head needs a full run now (lib/testing/ci/full-run.ts, owner decision D3). Run it
// in a checkout of main's head; every runner's scheduler asks it, GitHub's main-full-run.yml too.
// Usage: bun scripts/ci/full-run.ts due [--ledger <file>] [--run <commit>,<started>,<running|ended>]...
//   --ledger  A runner's ledger (CI_LEDGER of scripts/ci/job.ts): its `full` runs count.
//   --run     A full run another source reports: its commit, its start (ISO 8601 or epoch
//             seconds) and whether it ended. Repeat it for more runs.
// It prints {"run": true|false, "reason": "…"} and writes run= and reason= to $GITHUB_OUTPUT when
// set. An unreadable ledger or a malformed --run exits 1 without an answer.
const repository = resolve(import.meta.dir, '../..');
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { ledger: { type: 'string' }, run: { type: 'string', multiple: true } },
});
if (positionals.join(' ') !== 'due')
  throw new Error(
    'Usage: bun scripts/ci/full-run.ts due [--ledger <file>] [--run <commit>,<started>,<running|ended>]...',
  );

const now = new Date();
function reported(value: string): FullRun {
  const [commit, started, state] = value.split(',');
  const startedAt = new Date(/^\d+$/.test(started ?? '') ? Number(started) * 1000 : (started ?? ''));
  if (!commit || Number.isNaN(startedAt.getTime()) || (state !== 'running' && state !== 'ended'))
    throw new Error(`--run ${value} is no <commit>,<started>,<running|ended>.`);
  return {
    commit: git('rev-parse', '--verify', `${commit}^{commit}`).trim(),
    startedAt,
    ended: state === 'ended',
  };
}
const ledger = values.ledger === undefined ? [] : readLedger(values.ledger);
if ('unreadable' in ledger) throw new Error(`The ledger cannot count: ${ledger.unreadable}`);
const runs = [...fullRunsInLedger(ledger, now), ...(values.run ?? []).map(reported)];

/** The planner's answer for the change since `commit`: why it runs a tooling sample or every group. */
function tooling(commit: string): string | undefined {
  const directory = mkdtempSync(join(tmpdir(), 'full-run-'));
  const output = join(directory, 'outputs');
  try {
    execFileSync(process.execPath, ['scripts/ci-plan.ts', '--base', commit], {
      cwd: repository,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    if (outputs.full_reason === undefined || outputs.tooling_reason === undefined)
      return 'the planner named no full or tooling reason';
    return outputs.full_reason || outputs.tooling_reason || undefined;
  } catch (error) {
    return `the planner failed (${error instanceof Error ? error.message : String(error)})`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Markdown Tailwind scans for class names can change the stylesheet every page renders with, so it
// is no documentation here; an unknown scan counts every file.
const scans = await tailwindScan(readFileSync(join(repository, 'app/globals.css'), 'utf8'), repository);
const isDocs = (file: string): boolean => isDocsFile(file) && scans !== undefined && !scans(file);

function landedSince(commit: string): Landed | undefined {
  try {
    const files = git('diff', '--name-only', '--no-renames', '-z', commit, 'HEAD', '--')
      .split('\0')
      .filter(Boolean);
    return { files, tooling: () => tooling(commit), isDocs };
  } catch {
    return undefined;
  }
}

const decision = fullRunDue({
  now,
  history: git('rev-list', '--first-parent', `--max-count=${MAIN_HISTORY_DEPTH}`, 'HEAD').trim().split('\n'),
  runs,
  landedSince,
});
console.info(JSON.stringify(decision));
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `run=${decision.run}\nreason=${decision.reason.replace(/\s+/g, ' ')}\n`,
  );
