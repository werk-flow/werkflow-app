#!/usr/bin/env bun
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { CI_EVENTS } from '../../lib/testing/ci/dag';
import { positiveIntegerSchema, readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import {
  acknowledgedStart,
  acknowledgeStart,
  claimMainRun,
  releaseMainRun,
  RUN_COMMIT_LOCK,
  runCommit,
  type RunCommitInput,
  runVariables,
  unitName,
} from '../../lib/testing/ci/run-commit';
import { jobUserProblem, processExecutor } from './process-executor';
import { repository } from './run';

// One CI run of one commit off GitHub Actions: Plan on this host, the plan's jobs through the process
// executor, then Check on this host (lib/testing/ci/run-commit.ts). The Mac and any other runner call
// it for every run; the merge queue calls it as its --runner (scripts/ci/queue.ts), and its
// --main-runner for main after a landing. Run it from a trusted clone of werkflow-app that no job
// writes; it clones each job's checkout from that clone. Every job, Plan and Check included, runs as
// CI_JOB_USER (scripts/ci/process-executor.ts).
// Usage: bun scripts/ci/run-commit.ts   (executable: the queue starts it without arguments)
// It reads plain environment variables only. scripts/ci/job.ts names the run's variables it passes to
// every job: CI_EVENT, CI_RESULTS_DIR, CI_RUN_URL, CI_BASE_SHA or CI_FULL_REASON, CI_PRODUCER, CI_PRS,
// CI_PR_HEAD_REF, CI_PR_HEAD_SHA, SHRINK_ONLY_GROWTH_APPROVED, GITHUB_REPOSITORY, CI_CACHE_DIR. Also:
//   CI_COMMIT       The commit to run. The queue gives CI_QUEUE_COMMIT and CI_QUEUE_REPOSITORY instead.
//                   A commit this clone lacks is fetched: the queue's ref, else origin (and
//                   CI_PR_HEAD_REF for a pull request).
//   CI_JOB_USER     The user every job runs as, through one sudoers rule
//                   (`<this user> ALL=(<job user>) NOPASSWD:SETENV: /usr/bin/env`). Required; refused
//                   when it is this process's own user or root. It reads the trusted clone and writes
//                   CI_CACHE_DIR; the run's results directory and workspaces are made writable to it.
//   CI_JOB_GH_TOKEN A read-only GitHub token for the jobs that read GitHub (Plan, Fast), as their
//                   GH_TOKEN. This process's own GH_TOKEN never reaches a job.
//   CI_RUN_ATTEMPT  1 for a run's first attempt (also when unset). A rerun keeps CI_RUN_URL and
//                   CI_RESULTS_DIR and counts this up; the earlier attempt's results move to
//                   attempt-<n>/ in the results directory, and the rerun plans and runs every job anew.
//   CI_LEDGER       The runner's ledger, kept only when the executor runs jobs where they cannot write
//                   it and the orchestrator holds Plan's and Check's ledger work. The process executor
//                   runs Plan and Check's job.ts, which append themselves, so with it the run keeps no
//                   ledger and runs every job; main runs are still deduplicated by it.
//   CI_WORK_ROOT    A folder for the jobs' workspaces, the host's stack lock and its claims of main
//                   runs; one per host, shared by every run-commit there. Required.
//   CI_START_ACK    A file the run writes durably once it started (after its queued Check, before
//                   Plan), or once it found another main run of the commit started: the queue clears
//                   an owed main run only by it.
//   CI_PARALLEL     The most jobs at once, default 2.
//   CI_DEDICATED_HOST=1  This host's Docker serves CI alone: a job's stack replaces a running one.
//   CI_PUBLISHER    An executable that runs `bun scripts/ci/publish-check.ts <start|finish>` from the
//                   trusted copy as the CI App's user; it gets CI_RUN_URL, CI_RUN_ATTEMPT, CI_EVENT,
//                   CI_COMMIT, CI_TREE, CI_PR_HEAD_SHA, CI_RESULTS_DIR and GITHUB_REPOSITORY. The run posts
//                   `start` before Plan and starts nothing when that fails, and `finish` after Check.
//                   Refused for a queue run, whose commit is not on GitHub.
//   SIBLING_REPOSITORIES_TOKEN  Reaches only Fast's trusted sibling clone, which runs as this user.
// Exit 0: Check passed. 1: it failed. 2: the run never started: every failure before its start was
// acknowledged, such as a missing or unreadable variable, an attempt that does not count up, a
// results directory another run-commit holds, an `origin` or commit git cannot fetch, a queued Check
// the publisher could not post, or another main run of the commit that claimed it but has not
// started; a main run then gives up its claim of the commit. 3: nothing ran because another `main`
// run of the commit started already (the ledger holds its Plan, or its start on this host is
// acknowledged); CI_START_ACK names that run.
// Passed jobs' workspaces are removed at the end; a failed job's stays with its log.

/** A stop before the run started: 2, or 3 when another main run of the commit started. */
class Refusal extends Error {
  constructor(
    problem: string,
    readonly code: 2 | 3,
  ) {
    super(problem);
  }
}

function refuse(problem: string, code: 2 | 3 = 2): never {
  throw new Refusal(problem, code);
}

const environment = process.env;
/** Set once the run's start is acknowledged: every failure before it is a run that never started. */
let started = false;
/** What a stop undoes, newest first: the run's lock, and a main claim of a run that never started. */
const undo: (() => void)[] = [];

async function main(): Promise<0 | 1 | 2 | 3> {
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
  const jobUser = environment.CI_JOB_USER;
  const userProblem = jobUserProblem(jobUser);
  if (userProblem || !jobUser) return refuse(userProblem ?? 'CI_JOB_USER is required.');
  const ledger = environment.CI_LEDGER && resolve(environment.CI_LEDGER);
  const producer = environment.CI_PRODUCER || null;
  const startAck = environment.CI_START_ACK && resolve(environment.CI_START_ACK);

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
  // main run, runs nothing. It pays a debt by the other run only once that run started for certain:
  // its Plan is in the ledger, or its start on this host is acknowledged. A claim whose run has not
  // started, or died before it, leaves the debt owed.
  const mainRuns = join(workRoot, 'main-runs');
  const claim = join(mainRuns, commit);
  const startedMark = join(mainRuns, `${commit}.started`);
  const startedElsewhere = (owner: string): never => {
    if (startAck) acknowledgeStart(startAck, { commit, runUrl: owner });
    return refuse(`main's run of ${commit} started already: ${owner}.`, 3);
  };
  const claimedElsewhere = (owner: string): never =>
    acknowledgedStart(startedMark, commit) === owner
      ? startedElsewhere(owner)
      : refuse(
          `main's run of ${commit}: ${owner} claimed it but has not started. Run again once it started, or remove ${claim} once it no longer runs.`,
        );
  if (event === 'main') {
    if (ledger && existsSync(ledger)) {
      const receipts = readLedger(ledger);
      const earlier =
        'unreadable' in receipts
          ? undefined
          : receipts.find(
              (receipt) =>
                receipt.job === 'plan' &&
                receipt.event === 'main' &&
                receipt.commit === commit &&
                receipt.runUrl !== null &&
                receipt.runUrl !== runUrl,
            );
      if (earlier?.runUrl) startedElsewhere(earlier.runUrl);
    }
    const owner = existsSync(claim) ? readFileSync(claim, 'utf8') : undefined;
    if (owner !== undefined && owner !== runUrl) claimedElsewhere(owner);
  }

  // One orchestrator per results directory, for the run's whole life. scripts/ci/schedule.ts never
  // names a run whose directory holds the lock: its held shards are this orchestrator's to start.
  // The jobs write their results here as the job user; the sticky bit keeps this process's files its own.
  mkdirSync(resultsDir, { recursive: true });
  chmodSync(resultsDir, 0o1777);
  const lockPath = join(resultsDir, RUN_COMMIT_LOCK);
  let lock: number;
  try {
    lock = openSync(lockPath, 'wx');
  } catch {
    return refuse(
      `${lockPath} exists: another run-commit holds this run, or one died. Remove it once none runs.`,
    );
  }
  undo.push(() => {
    closeSync(lock);
    rmSync(lockPath, { force: true });
  });

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
  // The sudoers rule the jobs need, before anything starts.
  if (spawnSync('sudo', ['-n', '-u', jobUser, '--', '/usr/bin/env', 'true']).status !== 0)
    refuse(`sudo cannot run /usr/bin/env as ${jobUser} without a password; add the sudoers rule first.`);

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
      jobUser,
      log,
    });
  const jobs = executor(true);
  const host = executor(false);

  const input: RunCommitInput = {
    run: { event, commit, tree, runUrl, attempt: attempt.data, producer },
    env: {
      ...runVariables(environment),
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
  // the last step before the run starts. A run that does not start gives its claim up.
  if (event === 'main') {
    const claimed = claimMainRun(mainRuns, commit, runUrl);
    if ('unwritable' in claimed) refuse(claimed.unwritable);
    if ('owner' in claimed) claimedElsewhere(claimed.owner);
    undo.push(() => {
      if (!started) releaseMainRun(mainRuns, commit, runUrl);
    });
  }

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
                CI_TREE: tree,
                CI_RESULTS_DIR: resultsDir,
              },
            });
            return ran.status === 0;
          }
        : undefined,
      acknowledgeStart: () => {
        if (event === 'main') acknowledgeStart(startedMark, { commit, runUrl });
        if (startAck) acknowledgeStart(startAck, { commit, runUrl });
        started = true;
      },
      now: () => Date.now(),
      sleep: (ms, signal) =>
        new Promise((resolveSleep) => {
          const timer = setTimeout(resolveSleep, ms);
          signal.addEventListener('abort', () => (clearTimeout(timer), resolveSleep(undefined)), {
            once: true,
          });
        }),
      log,
      // A result the job user wrote is replaced, never written into: this process owns the directory.
      writeResult: (unit, result) => {
        const path = join(resultsDir, resultFileName(unit.job, unit.shard));
        writeFileSync(`${path}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
        renameSync(`${path}.tmp`, path);
      },
    },
    controller.signal,
  );
  for (const { unit, state } of outcome.units) {
    const folder = jobs.workspace(unit);
    if (state === 'passed') jobs.remove(folder);
    else if (existsSync(folder)) log(`[run] ${unitName(unit)} ${state}: its workspace stays at ${folder}`);
  }
  if (outcome.exitCode === 0) jobs.remove(root);
  log(
    `[run] ${event} run of ${commit}: ${outcome.exitCode === 2 ? 'not started' : `Check ${outcome.exitCode === 0 ? 'passed' : 'failed'}`}`,
  );
  return outcome.exitCode;
}

const exitCode = await main().catch((error: unknown): 1 | 2 | 3 => {
  if (error instanceof Refusal) {
    console.error(`[run] ${error.message}`);
    return error.code;
  }
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[run] ${started ? 'the run failed' : 'the run could not start'}: ${detail}`);
  return started ? 1 : 2;
});
for (const step of undo.reverse()) step();
process.exit(exitCode);
