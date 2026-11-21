#!/usr/bin/env bun
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { CI_EVENTS } from '../../lib/testing/ci/dag';
import { positiveIntegerSchema, readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import {
  claimMainRun,
  RUN_COMMIT_LOCK,
  runCommit,
  type RunCommitInput,
  unitName,
} from '../../lib/testing/ci/run-commit';
import { processExecutor } from './process-executor';
import { repository } from './run';

// One CI run of one commit off GitHub Actions: Plan on this host, the plan's jobs through the process
// executor, then Check on this host (lib/testing/ci/run-commit.ts). The Mac and any other runner call
// it for every run; the merge queue calls it as its --runner (scripts/ci/queue.ts), and its
// --main-runner for main after a landing. Run it from a trusted clone of werkflow-app that no job
// writes; it clones each job's checkout from that clone.
// Usage: bun scripts/ci/run-commit.ts   (executable: the queue starts it without arguments)
// It reads plain environment variables only. scripts/ci/job.ts names the run's variables it passes to
// every job: CI_EVENT, CI_RESULTS_DIR, CI_RUN_URL, CI_BASE_SHA or CI_FULL_REASON, CI_PRODUCER, CI_PRS,
// CI_PR_HEAD_REF, CI_PR_HEAD_SHA, SHRINK_ONLY_GROWTH_APPROVED, GITHUB_REPOSITORY, CI_CACHE_DIR. Also:
//   CI_COMMIT       The commit to run. The queue gives CI_QUEUE_COMMIT and CI_QUEUE_REPOSITORY instead.
//                   A commit this clone lacks is fetched: the queue's ref, else origin (and
//                   CI_PR_HEAD_REF for a pull request).
//   CI_RUN_ATTEMPT  1 for a run's first attempt (also when unset). A rerun keeps CI_RUN_URL and
//                   CI_RESULTS_DIR and counts this up; the earlier attempt's results move to
//                   attempt-<n>/ in the results directory, and the rerun plans and runs every job anew.
//   CI_LEDGER       The runner's ledger, kept only when the executor runs jobs where they cannot write
//                   it. The process executor runs them as this user, so with it the run keeps no
//                   ledger and runs every job; main runs are still deduplicated by it. With an
//                   isolating executor only Plan and Check, on this host, see it, and the orchestrator
//                   appends every other job's start before it begins and its end after.
//   CI_WORK_ROOT    A folder for the jobs' workspaces, the host's stack lock and its claims of main
//                   runs; one per host, shared by every run-commit there. Required.
//   CI_PARALLEL     The most jobs at once, default 2.
//   CI_DEDICATED_HOST=1  This host's Docker serves CI alone: a job's stack replaces a running one.
//   CI_PUBLISHER    An executable that runs `bun scripts/ci/publish-check.ts <start|finish>` from the
//                   trusted copy as the CI App's user; it gets CI_RUN_URL, CI_RUN_ATTEMPT, CI_EVENT,
//                   CI_COMMIT, CI_PR_HEAD_SHA, CI_RESULTS_DIR and GITHUB_REPOSITORY. The run posts
//                   `start` before Plan and starts nothing when that fails, and `finish` after Check.
//                   Refused for a queue run, whose commit is not on GitHub.
//   GH_TOKEN        Plan and Fast read GitHub with it; SIBLING_REPOSITORIES_TOKEN reaches only Fast's clone.
// Exit 0: Check passed. 1: it failed or did not run. 2: refused before anything ran: a missing or
// unreadable variable, an attempt that does not count up, a results directory another run-commit
// holds, or an `origin` or commit git cannot fetch. 3: nothing ran because another `main` run of the
// commit started already (the ledger holds its Plan, or it claimed the commit on this host).
// Passed jobs' workspaces are removed at the end; a failed job's stays with its log.

/** This run's lock once taken: a refusal after it releases it, so none is left behind. */
const held: { release?: () => void } = {};

/** Stops before anything ran: 2 for a refusal, 3 when another main run of the commit started. */
function refuse(problem: string, code: 2 | 3 = 2): never {
  held.release?.();
  console.error(`[run] ${problem}`);
  process.exit(code);
}

const environment = process.env;
const event = CI_EVENTS.find((name) => name === environment.CI_EVENT);
const resultsDir = environment.CI_RESULTS_DIR && resolve(environment.CI_RESULTS_DIR);
const runUrl = environment.CI_RUN_URL;
const commit = environment.CI_QUEUE_COMMIT || environment.CI_COMMIT;
const workRoot = environment.CI_WORK_ROOT && resolve(environment.CI_WORK_ROOT);
if (!event || !resultsDir || !runUrl || !commit || !workRoot)
  refuse(
    `CI_EVENT (${CI_EVENTS.join('|')}), CI_RESULTS_DIR, CI_RUN_URL, CI_COMMIT and CI_WORK_ROOT are required.`,
  );
if (!/^[0-9a-f]{40}$/.test(commit)) refuse(`CI_COMMIT ${commit} is no full commit id.`);
const attempt = positiveIntegerSchema.safeParse(Number(environment.CI_RUN_ATTEMPT || '1'));
const parallel = positiveIntegerSchema.safeParse(Number(environment.CI_PARALLEL || '2'));
if (!attempt.success) refuse(`CI_RUN_ATTEMPT ${environment.CI_RUN_ATTEMPT} is no attempt number.`);
if (!parallel.success) refuse(`CI_PARALLEL ${environment.CI_PARALLEL} is no number of jobs.`);
const queueRun = Boolean(environment.CI_QUEUE_COMMIT);
if (queueRun && environment.CI_PUBLISHER)
  refuse(
    "A queue run posts no Check: its commit is not on GitHub, and the queue's verdict reaches it as Queue.",
  );
const ledger = environment.CI_LEDGER && resolve(environment.CI_LEDGER);
const producer = environment.CI_PRODUCER || null;

const git = (...args: string[]): string => {
  try {
    return execFileSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      env: { ...environment, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    }).trim();
  } catch {
    return refuse(`git ${args.join(' ')} failed.`);
  }
};
// At most one main run per commit: a second starter, such as a push trigger after the queue's own
// main run, refuses before it runs anything.
if (event === 'main' && ledger && existsSync(ledger)) {
  const receipts = readLedger(ledger);
  const earlier =
    'unreadable' in receipts
      ? undefined
      : receipts.find(
          (receipt) =>
            receipt.job === 'plan' &&
            receipt.event === 'main' &&
            receipt.commit === commit &&
            receipt.runUrl !== runUrl,
        );
  if (earlier) refuse(`main's run of ${commit} started already: ${earlier.runUrl}.`, 3);
}

// One orchestrator per results directory, for the run's whole life. scripts/ci/schedule.ts never
// names a run whose directory holds the lock: its held shards are this orchestrator's to start.
mkdirSync(resultsDir, { recursive: true });
const lockPath = join(resultsDir, RUN_COMMIT_LOCK);
let lock: number;
try {
  lock = openSync(lockPath, 'wx');
} catch {
  refuse(`${lockPath} exists: another run-commit holds this run, or one died. Remove it once none runs.`);
}
const release = (): void => {
  closeSync(lock);
  rmSync(lockPath, { force: true });
};
held.release = release;

// A rerun plans and runs every job again; the earlier attempt's results move aside, so Check never
// counts a result of another Plan.
const earlierPlan = readResult(join(resultsDir, resultFileName('plan', null)));
const left = readdirSync(resultsDir).filter(
  (file) => file !== RUN_COMMIT_LOCK && !/^attempt-[0-9]+$/.test(file),
);
if (left.length) {
  const earlierAttempt = 'unreadable' in earlierPlan ? null : (earlierPlan.attempt ?? 1);
  if (earlierAttempt === null || earlierAttempt >= attempt.data)
    refuse(
      earlierAttempt === null
        ? `${resultsDir} holds results without a readable Plan; give the run a fresh results directory.`
        : `${resultsDir} holds attempt ${earlierAttempt}; a rerun counts CI_RUN_ATTEMPT up.`,
    );
  const aside = join(resultsDir, `attempt-${earlierAttempt}`);
  mkdirSync(aside, { recursive: true });
  for (const file of left) renameSync(join(resultsDir, file), join(aside, file));
}

// The jobs read GitHub's branches through this clone's `origin` (scripts/ci/process-executor.ts).
git('fetch', '--quiet', '--no-tags', 'origin');
const hasCommit = (): boolean =>
  spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repository }).status === 0;
if (!hasCommit()) {
  if (queueRun)
    git(
      'fetch',
      '--quiet',
      '--no-tags',
      environment.CI_QUEUE_REPOSITORY ?? repository,
      `refs/ci-queue/runs/${commit}`,
    );
  else
    git(
      'fetch',
      '--quiet',
      '--no-tags',
      'origin',
      commit,
      ...(environment.CI_PR_HEAD_REF ? [environment.CI_PR_HEAD_REF] : []),
    );
  if (!hasCommit()) refuse(`${commit} cannot be fetched.`);
}
const tree = git('rev-parse', `${commit}^{tree}`);

const runKey = `${createHash('sha256').update(runUrl).digest('hex').slice(0, 16)}-${attempt.data}`;
const root = join(workRoot, runKey);
const log = (line: string): void => console.info(line);
const executor = (machineStart: boolean) =>
  processExecutor({
    source: repository,
    root,
    commit,
    machineStart,
    replaceStack: environment.CI_DEDICATED_HOST === '1',
    stackLock: join(workRoot, 'stack.lock'),
    log,
  });
const jobs = executor(true);
const host = executor(false);

const PASSED_TO_JOBS = [
  'CI_EVENT',
  'CI_RESULTS_DIR',
  'CI_RUN_URL',
  'CI_BASE_SHA',
  'CI_FULL_REASON',
  'CI_PRODUCER',
  'CI_PRS',
  'CI_PR_HEAD_REF',
  'CI_PR_HEAD_SHA',
  'CI_FIRST_ATTEMPT_CLASS',
  'SHRINK_ONLY_GROWTH_APPROVED',
  'GITHUB_REPOSITORY',
  'CI_CACHE_DIR',
  'GH_TOKEN',
  'SIBLING_REPOSITORIES_TOKEN',
];
const input: RunCommitInput = {
  run: { event, commit, tree, runUrl, attempt: attempt.data, producer },
  env: {
    ...Object.fromEntries(
      PASSED_TO_JOBS.flatMap((name) => (environment[name] ? [[name, environment[name] ?? '']] : [])),
    ),
    CI_RESULTS_DIR: resultsDir,
    ...(ledger && producer ? { CI_LEDGER: ledger } : {}),
  },
  parallel: parallel.data,
};

const publisher = environment.CI_PUBLISHER && resolve(environment.CI_PUBLISHER);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    log(`[run] ${signal}: stopping every job, then Check`);
    controller.abort();
  });

// The same on this host before any Plan wrote: the first starter claims the commit, atomically, as
// the last step before the run starts, so a run that never started claims nothing.
if (event === 'main') {
  const claimed = claimMainRun(join(workRoot, 'main-runs'), commit, runUrl);
  if ('unwritable' in claimed) refuse(claimed.unwritable);
  if ('owner' in claimed) refuse(`main's run of ${commit} started already: ${claimed.owner}.`, 3);
}

let exitCode = 1;
try {
  const outcome = await runCommit(
    input,
    {
      host,
      jobs,
      readResult: (unit) => readResult(join(resultsDir, resultFileName(unit.job, unit.shard))),
      appendReceipt:
        ledger && producer ? (receipt) => appendFileSync(ledger, `${JSON.stringify(receipt)}\n`) : undefined,
      publish: publisher
        ? async (mode) => {
            const ran = spawnSync(publisher, [mode], {
              stdio: 'inherit',
              env: {
                ...environment,
                CI_RUN_URL: runUrl,
                CI_RUN_ATTEMPT: String(attempt.data),
                CI_EVENT: event,
                CI_COMMIT: commit,
                CI_RESULTS_DIR: resultsDir,
              },
            });
            return ran.status === 0;
          }
        : undefined,
      now: () => Date.now(),
      sleep: (ms, signal) =>
        new Promise((resolveSleep) => {
          const timer = setTimeout(resolveSleep, ms);
          signal.addEventListener('abort', () => (clearTimeout(timer), resolveSleep(undefined)), {
            once: true,
          });
        }),
      log,
      writeResult: (unit, result) =>
        writeFileSync(
          join(resultsDir, resultFileName(unit.job, unit.shard)),
          `${JSON.stringify(result, null, 2)}\n`,
        ),
    },
    controller.signal,
  );
  exitCode = outcome.exitCode;
  for (const { unit, state } of outcome.units) {
    const folder = jobs.workspace(unit);
    if (state === 'passed') rmSync(folder, { recursive: true, force: true });
    else if (existsSync(folder)) log(`[run] ${unitName(unit)} ${state}: its workspace stays at ${folder}`);
  }
  if (exitCode === 0) rmSync(root, { recursive: true, force: true });
  log(`[run] ${event} run of ${commit}: Check ${exitCode === 0 ? 'passed' : 'failed'}`);
} finally {
  release();
}
process.exit(exitCode);
