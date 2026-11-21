import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type FullRunDecision, fullRunsInLedger } from '../../lib/testing/ci/full-run';
import { readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import { RUN_COMMIT_LOCK } from '../../lib/testing/ci/run-commit';
import {
  CLOCK_WORK_NAMES,
  heldUntil,
  type ScheduleState,
  scheduleDue,
  scheduleStateSchema,
} from '../../lib/testing/ci/schedule';
import { lsRemoteCommit } from '../../lib/testing/ci/superseded';
import { workflowsFolder } from '../../lib/testing/ci-workflow';

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
//               plan's midnight hold ended and the run has no midnight.json yet. A merge queue
//               run's directory too (scripts/ci/queue.ts): its runner waits and starts nothing.
//               Never due while scripts/ci/run-commit.ts holds the run: it starts its own held shards.
//     --pr-run  A pull request run in progress: the runner's id for it, the ref on origin that holds
//               the PR's head (refs/pull/<n>/head), and the head commit the run tests.
//   It prints {"start": [...], "stop": [...], "unanswered": [...], "wakeAt": "<ISO time>"}:
//     release   Dispatch the release on GitHub Actions, which decides like a scheduled run:
//               gh workflow run release.yml --ref main -f scheduled=true. Never on a branch. Named
//               only while release.yml has no `schedule` trigger: GitHub's cron and hold start it
//               otherwise, and one weekday never gets two releases.
//     nightly   A full run of main's head: CI_EVENT=full CI_FULL_REASON='Nightly run'.
//     full      A full run of main's head: CI_EVENT=full CI_FULL_REASON='Full run on main'.
//     midnight  bun scripts/ci/job.ts midnight in that run, then its browser shards after Fast.
//     stop      End every job of that run: a newer push superseded it.
//   After starting releases or nightlies, record their slots in one call, one call at a time per
//   state file: bun scripts/ci/schedule.ts started <release|nightly> <slot> [...] --state <file>
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
  '       bun scripts/ci/schedule.ts started <release|nightly> <slot> [<release|nightly> <slot>]... --state <file>';
const statePath = values.state;
if (!statePath) throw new Error(usage);

function readState(path: string): ScheduleState {
  if (!existsSync(path)) return {};
  const parsed = scheduleStateSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${path} is no schedule state: ${parsed.error.message}`);
  return parsed.data;
}

const [command, ...pairs] = positionals;
if (command === 'started') {
  if (!pairs.length || pairs.length % 2) throw new Error(usage);
  const state = readState(statePath);
  for (let index = 0; index < pairs.length; index += 2) {
    const name = CLOCK_WORK_NAMES.find((candidate) => candidate === pairs[index]);
    const started = new Date(pairs[index + 1] ?? '');
    if (!name || Number.isNaN(started.getTime())) throw new Error(usage);
    const recorded = state[name];
    // A late confirmation of an older slot never hides a newer one.
    if (!recorded || new Date(recorded) < started) state[name] = started.toISOString();
  }
  // Written whole, then renamed: a reader never sees half a state.
  const next = `${statePath}.${process.pid}.next`;
  writeFileSync(next, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(next, statePath);
  process.exit(0);
}
if (command !== 'due' || positionals.length !== 1) throw new Error(usage);

function fullRun(): FullRunDecision | { unreadable: string } {
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
      return {
        run: decision.run,
        reason: decision.reason,
        // Only an explicit `true` skips the nightly; anything else leaves it due.
        ...('headHasFullRun' in decision && decision.headHasFullRun === true ? { headHasFullRun: true } : {}),
      };
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
  // A run's held shards have one starter: the run-commit that holds the run, or this answer. A
  // run-commit that died leaves its lock, and the run waits for a person: remove the run's
  // run-commit.lock once no run-commit runs it, and its held shards are due here again.
  if (existsSync(join(run, RUN_COMMIT_LOCK)) || existsSync(join(run, resultFileName('midnight', null))))
    return { run, until: undefined };
  const plan = readResult(join(run, resultFileName('plan', null)));
  if ('unreadable' in plan) return { run, until: { unreadable: plan.unreadable } };
  if (!plan.plan) return { run, until: { unreadable: 'its plan result holds no plan' } };
  return { run, until: heldUntil(plan.plan) };
});

/** Whether release.yml has a `schedule` trigger, or why it cannot be read. */
function releaseOnCron(): boolean | { unreadable: string } {
  try {
    const workflow: unknown = Bun.YAML.parse(
      readFileSync(join(repository, workflowsFolder(), 'release.yml'), 'utf8'),
    );
    const triggers =
      typeof workflow === 'object' && workflow !== null && 'on' in workflow ? workflow.on : undefined;
    if (typeof triggers !== 'object' || triggers === null)
      return { unreadable: 'release.yml names no triggers' };
    return 'schedule' in triggers && Array.isArray(triggers.schedule) && triggers.schedule.length > 0;
  } catch (error) {
    return {
      unreadable: `release.yml cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const now = new Date();
const ledger = values.ledger === undefined ? [] : readLedger(values.ledger);
const answer = scheduleDue({
  now,
  state: readState(statePath),
  fullRun,
  releaseOnCron: releaseOnCron(),
  fullRunning: 'unreadable' in ledger ? ledger : fullRunsInLedger(ledger, now).some((run) => !run.ended),
  held,
  prRuns,
  remoteHead,
});
console.info(JSON.stringify(answer));
if (answer.unanswered.length) process.exitCode = 1;
