import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fullRunsInLedger } from '../../lib/testing/ci/full-run';
import { readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import {
  CLOCK_WORK_NAMES,
  heldUntil,
  type ScheduleState,
  scheduleDue,
  scheduleStateSchema,
} from '../../lib/testing/ci/schedule';
import { lsRemoteCommit } from '../../lib/testing/ci/superseded';

// What a CI runner's orchestrator starts and stops now, so no runner waits for a clock
// (lib/testing/ci/schedule.ts). Run it in a checkout of main's head, every few minutes and at the
// `wakeAt` it prints.
// Usage:
//   bun scripts/ci/schedule.ts due --state <file> [--ledger <file>] [--run <results dir>]...
//                                  [--pr-run <id>,<head ref>,<tested commit>]...
//     --state   The runner's schedule state, which `started` writes. A missing file has started
//               nothing, so today's missed slots are due.
//     --ledger  The runner's ledger (CI_LEDGER): a nightly waits while a full run in it runs, and
//               scripts/ci/full-run.ts due reads it.
//     --run     A run's results directory (CI_RESULTS_DIR) whose browser shards wait: due once its
//               plan's midnight hold ended and the run has no midnight.json yet.
//     --pr-run  A pull request run in progress: the runner's id for it, the ref on origin that holds
//               the PR's head (refs/pull/<n>/head), and the head commit the run tests.
//   It prints {"start": [...], "stop": [...], "unanswered": [...], "wakeAt": "<ISO time>"}:
//     release   Dispatch the release on GitHub Actions, which decides like a scheduled run:
//               gh workflow run release.yml --ref main -f scheduled=true. Never on a branch.
//     nightly   A full run of main's head: CI_EVENT=full CI_FULL_REASON='Nightly run'.
//     full      A full run of main's head: CI_EVENT=full CI_FULL_REASON='Full run on main'.
//     midnight  bun scripts/ci/job.ts midnight in that run, then its browser shards after Fast.
//     stop      End every job of that run: a newer push superseded it.
//   After starting a release or a nightly, record its slot:
//   bun scripts/ci/schedule.ts started <release|nightly> <slot> --state <file>
//   An unreadable state exits 1 without an answer. Work the scheduler could not decide is listed
//   in `unanswered`, and then it exits 1 after printing the rest.
const repository = resolve(import.meta.dir, '../..');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    state: { type: 'string' },
    ledger: { type: 'string' },
    run: { type: 'string', multiple: true },
    'pr-run': { type: 'string', multiple: true },
  },
});
const usage =
  'Usage: bun scripts/ci/schedule.ts due --state <file> [--ledger <file>] [--run <dir>]... [--pr-run <id>,<ref>,<commit>]...\n' +
  '       bun scripts/ci/schedule.ts started <release|nightly> <slot> --state <file>';
const statePath = values.state;
if (!statePath) throw new Error(usage);

function readState(path: string): ScheduleState {
  if (!existsSync(path)) return {};
  const parsed = scheduleStateSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is no schedule state: ${parsed.error.message}`);
  return parsed.data;
}

const [command, work, slot] = positionals;
if (command === 'started') {
  const name = CLOCK_WORK_NAMES.find((candidate) => candidate === work);
  const started = new Date(slot ?? '');
  if (!name || Number.isNaN(started.getTime()) || positionals.length !== 3) throw new Error(usage);
  const state = readState(statePath);
  const recorded = state[name];
  // A late confirmation of an older slot never hides a newer one.
  if (!recorded || new Date(recorded) < started) state[name] = started.toISOString();
  writeFileSync(`${statePath}.next`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${statePath}.next`, statePath);
  process.exit(0);
}
if (command !== 'due' || positionals.length !== 1) throw new Error(usage);

function fullRun(): { run: boolean; reason: string } | { unreadable: string } {
  const answer = spawnSync(
    process.execPath,
    ['scripts/ci/full-run.ts', 'due', ...(values.ledger ? ['--ledger', values.ledger] : [])],
    { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const line = answer.stdout.trim().split('\n').at(-1) ?? '';
  try {
    const decision: unknown = JSON.parse(line);
    if (
      answer.status === 0 &&
      typeof decision === 'object' &&
      decision !== null &&
      'run' in decision &&
      typeof decision.run === 'boolean' &&
      'reason' in decision &&
      typeof decision.reason === 'string'
    )
      return { run: decision.run, reason: decision.reason };
  } catch {
    // Not JSON: no answer, below.
  }
  return { unreadable: `scripts/ci/full-run.ts due ended ${answer.status} without an answer` };
}

const prRuns = (values['pr-run'] ?? []).map((value) => {
  const [run, headRef, testedHead] = value.split(',');
  if (!run || !headRef?.startsWith('refs/') || !/^[0-9a-f]{40,64}$/.test(testedHead ?? ''))
    throw new Error(`--pr-run ${value} is no <id>,<head ref>,<tested commit>.`);
  return { run, headRef, testedHead: testedHead ?? '' };
});
// One question to origin for every head ref; an unanswered one stops no run.
let heads: string | undefined;
function remoteHead(ref: string): string | undefined {
  if (heads === undefined) {
    const answer = spawnSync('git', ['ls-remote', 'origin', ...new Set(prRuns.map((run) => run.headRef))], {
      cwd: repository,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    if (answer.status !== 0) console.warn('git ls-remote origin failed, so no pull request run stops.');
    heads = answer.status === 0 ? answer.stdout : '';
  }
  return lsRemoteCommit(heads, ref);
}

const held = (values.run ?? []).map((run) => {
  if (existsSync(join(run, resultFileName('midnight', null)))) return { run, until: undefined };
  const plan = readResult(join(run, resultFileName('plan', null)));
  if ('unreadable' in plan) return { run, until: { unreadable: plan.unreadable } };
  if (!plan.plan) return { run, until: { unreadable: 'its plan result holds no plan' } };
  return { run, until: heldUntil(plan.plan) };
});

const now = new Date();
const ledger = values.ledger === undefined ? [] : readLedger(values.ledger);
const answer = scheduleDue({
  now,
  state: readState(statePath),
  fullRun,
  fullRunning: 'unreadable' in ledger ? ledger : fullRunsInLedger(ledger, now).some((run) => !run.ended),
  held,
  prRuns,
  remoteHead,
});
console.info(JSON.stringify(answer));
if (answer.unanswered.length) process.exitCode = 1;
