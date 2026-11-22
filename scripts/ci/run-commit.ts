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
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { CI_EVENTS } from '../../lib/testing/ci/dag';
import { MIRROR_JOB_CAP } from '../../lib/testing/ci/mirror';
import { positiveIntegerSchema, readLedger, readResult, resultFileName } from '../../lib/testing/ci/results';
import {
  acknowledgedStart,
  acknowledgeStart,
  claimMainRun,
  type Executors,
  type ExecutorSetup,
  isolationProblem,
  mainStartRecord,
  releaseMainRun,
  RUN_COMMIT_LOCK,
  runCommit,
  type RunCommitInput,
  type RunCommitOutcome,
  runVariables,
} from '../../lib/testing/ci/run-commit';
import { mirrorExecutors } from './mirror-executor';
import { githubMirrorApi } from './mirror-api';
import { mirrorIdentity, pushMirrorCommit } from './mirror-push';
import { processExecutors } from './process-executor';
import { repository as ownRepository } from './run';

// One CI run of one commit off GitHub Actions: Plan on this host, the plan's jobs through an executor,
// then Check on this host (lib/testing/ci/run-commit.ts). Run it from a trusted clone of
// werkflow-app that no job writes; the executor makes each job's checkout from that clone.
//
// The executor (Executors in lib/testing/ci/run-commit.ts) decides where jobs run. With
// CI_EXECUTOR=mirror it is the CI mirror (scripts/ci/mirror-executor.ts, which names its variables):
// every job but Plan and Check runs on GitHub's machines in a repository of its own, so the run may
// keep a ledger, come from the queue and post its Check. Otherwise it is the process executor
// (scripts/ci/process-executor.ts), which runs every job as this user and isolates nothing, so it
// serves local and test runs only: run-commit refuses it whenever the run has a ledger, comes from
// the merge queue (--runner, --main-runner), posts its Check or holds a credential
// (isolationProblem). The Mac's runner keeps calling scripts/ci/prepare.ts and scripts/ci/job.ts per
// job in its own container.
// Usage: bun scripts/ci/run-commit.ts   (executable: it takes no arguments)
// It reads plain environment variables only. scripts/ci/job.ts names the run's variables it passes to
// every job: CI_EVENT, CI_RESULTS_DIR, CI_RUN_URL, CI_BASE_SHA or CI_FULL_REASON, CI_PRODUCER, CI_PRS,
// CI_PR_HEAD_REF, CI_PR_HEAD_SHA, SHRINK_ONLY_GROWTH_APPROVED, GITHUB_REPOSITORY, CI_CACHE_DIR. Also:
//   CI_COMMIT       The commit to run. The queue gives CI_QUEUE_COMMIT and CI_QUEUE_REPOSITORY instead,
//                   and CI_QUEUE_MAIN_RUN=1 for main's run after a landing. A commit this clone lacks
//                   is fetched: the queue's ref, else origin (and CI_PR_HEAD_REF for a pull request).
//   CI_JOB_GH_TOKEN A read-only GitHub token for the jobs that read GitHub (Plan, Fast), as their
//                   GH_TOKEN; an isolating executor only. This process's own GH_TOKEN never reaches a job.
//   CI_RUN_ATTEMPT  1 for a run's first attempt (also when unset). A rerun keeps CI_RUN_URL and
//                   CI_RESULTS_DIR and counts this up; the earlier attempt's results move to
//                   attempt-<n>/ in the results directory, and the rerun plans and runs every job anew.
//   CI_LEDGER       The runner's ledger; an isolating executor only. main runs are deduplicated by it.
//   CI_WORK_ROOT    A folder only this user writes, for the jobs' workspaces, the host's stack lock,
//                   the folder the token-holding steps run in (trusted/), and the claims and start
//                   records of main runs (main-runs/); one per host, shared by every run-commit there.
//                   Required. A main run through an isolating executor writes its start record
//                   (main-runs/<commit>.started) durably once its Plan's body launched, or once Plan's
//                   setup failed before it; a second main run of the commit and the queue's owed main
//                   run read that one record. A run through the process executor writes neither.
//   CI_PARALLEL     The most jobs at once, default 2. On the mirror, 56: its own cap holds every
//                   run of the host together.
//   CI_EXECUTOR     `mirror` for the CI mirror; unset for the process executor.
//   CI_DEDICATED_HOST=1  This host's Docker serves CI alone: a job's stack replaces a running one.
//   CI_PUBLISHER    An executable that runs `bun scripts/ci/publish-check.ts <start|finish>` from the
//                   trusted copy as the CI App's user; an isolating executor only. It gets CI_RUN_URL,
//                   CI_RUN_ATTEMPT, CI_EVENT, CI_COMMIT, CI_TREE, CI_PR_HEAD_SHA, CI_RESULTS_DIR and
//                   GITHUB_REPOSITORY. The run posts `start` before Plan and starts nothing when that
//                   fails, and `finish` after Check. Refused for a queue run, whose commit is not on GitHub.
//   SIBLING_REPOSITORIES_TOKEN  Reaches only Fast's trusted sibling clone; an isolating executor only.
// Exit 0: Check passed. 1: it failed. 2: the run never started: every failure before its start was
// acknowledged, such as a missing or unreadable variable, a refused executor, an attempt that does
// not count up, a results directory another run-commit holds, an `origin` or commit git cannot fetch,
// a queued Check the publisher could not post, or another main run of the commit that claimed it but
// has not started; a main run then gives up its claim of the commit. 3: nothing ran because another
// `main` run of the commit started already (the ledger holds its Plan, or its start record on this
// host names it); the start record names that run. 4: Check ran, but the publisher did not post its
// verdict, so this run's `Check` stays queued; a refusal because a newer run owns `Check` exits 4 too.
// The executor frees what the run left (Executors.release).

/** What each exit of runCommit says of the run. */
const verdicts: Record<RunCommitOutcome['exitCode'], string> = {
  0: 'Check passed',
  1: 'Check failed',
  2: 'not started',
  4: 'its Check verdict was not posted',
};

/** The environment without the CI mirror's repository and token, which only its executor takes. */
function withoutMirror(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== 'CI_MIRROR_REPO' && name !== 'CI_MIRROR_TOKEN'),
  );
}

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

/** One run of run-commit: where it runs, with which variables and executor, until `signal` stops it. */
type RunCommitCommand = {
  /** The trusted clone the run's checkouts come from. */
  repository: string;
  environment: Readonly<Record<string, string | undefined>>;
  executors(setup: ExecutorSetup): Executors;
  signal: AbortSignal;
  log(line: string): void;
  /** Why the run refused or failed. */
  error(line: string): void;
};

/** Runs one commit's CI run as the header says, and returns its exit code. */
export async function runCommitCommand(command: RunCommitCommand): Promise<0 | 1 | 2 | 3 | 4> {
  /** Set once the run's start is acknowledged: every failure before it is a run that never started. */
  const state = { started: false };
  /** What a stop undoes, newest first: the run's lock, and a main claim of a run that never started. */
  const undo: (() => void)[] = [];
  try {
    return await run(command, state, undo);
  } catch (error) {
    if (error instanceof Refusal) {
      command.error(`[run] ${error.message}`);
      return error.code;
    }
    const detail = error instanceof Error ? error.message : String(error);
    command.error(`[run] ${state.started ? 'the run failed' : 'the run could not start'}: ${detail}`);
    return state.started ? 1 : 2;
  } finally {
    for (const step of undo.reverse()) step();
  }
}

async function run(
  { repository, environment, executors, signal, log }: RunCommitCommand,
  state: { started: boolean },
  undo: (() => void)[],
): Promise<0 | 1 | 2 | 3 | 4> {
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
  const runKey = `${createHash('sha256').update(runUrl).digest('hex').slice(0, 16)}-${attempt.data}`;
  const { host, jobs, release } = executors({
    source: repository,
    commit,
    workRoot,
    runKey,
    replaceStack: environment.CI_DEDICATED_HOST === '1',
    log,
  });
  // A job of an executor that isolates nothing reaches whatever this process holds.
  const isolated = host.isolatesJobs && jobs.isolatesJobs;
  const unisolated = isolationProblem(isolated, environment);
  if (unisolated) refuse(unisolated);
  // Only a run whose jobs cannot reach the work root writes main's claims and start records, which
  // the queue and a second main run trust: a local run through the process executor writes none.
  const recordsMain = event === 'main' && isolated;

  const git = (...args: string[]): string => {
    try {
      return execFileSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        env: { NODE_ENV: process.env.NODE_ENV, ...environment, GIT_TERMINAL_PROMPT: '0' },
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
  const startRecord = mainStartRecord(workRoot, commit);
  const claimedElsewhere = (owner: string): never =>
    acknowledgedStart(startRecord, commit) === owner
      ? refuse(`main's run of ${commit} started already: ${owner}.`, 3)
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
      // Its Plan in the ledger proves it started: this host's start record of the commit names it.
      if (earlier?.runUrl) {
        if (recordsMain) acknowledgeStart(startRecord, { commit, runUrl: earlier.runUrl });
        refuse(`main's run of ${commit} started already: ${earlier.runUrl}.`, 3);
      }
    }
    const owner = existsSync(claim) ? readFileSync(claim, 'utf8') : undefined;
    if (owner !== undefined && owner !== runUrl) claimedElsewhere(owner);
  }

  // One orchestrator per results directory, for the run's whole life. scripts/ci/schedule.ts never
  // names a run whose directory holds the lock: its held shards are this orchestrator's to start.
  mkdirSync(resultsDir, { recursive: true });
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

  // The jobs read GitHub's branches through this clone's `origin`.
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

  // The same on this host before any Plan wrote: the first starter claims the commit, atomically, as
  // the last step before the run starts. A run that does not start gives its claim up.
  if (recordsMain) {
    const claimed = claimMainRun(mainRuns, commit, runUrl);
    if ('unwritable' in claimed) refuse(claimed.unwritable);
    if ('owner' in claimed) claimedElsewhere(claimed.owner);
    undo.push(() => {
      if (!state.started) releaseMainRun(mainRuns, commit, runUrl);
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
                NODE_ENV: process.env.NODE_ENV,
                ...withoutMirror(environment),
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
      // Once Plan's body launched: the one record a second main run and the queue read.
      acknowledgeStart: () => {
        if (recordsMain) acknowledgeStart(startRecord, { commit, runUrl });
        state.started = true;
      },
      now: () => Date.now(),
      sleep: (ms, sleepSignal) =>
        new Promise((resolveSleep) => {
          const timer = setTimeout(resolveSleep, ms);
          sleepSignal.addEventListener('abort', () => (clearTimeout(timer), resolveSleep(undefined)), {
            once: true,
          });
        }),
      log,
      // A result a job wrote is replaced, never written into.
      writeResult: (unit, result) => {
        const path = join(resultsDir, resultFileName(unit.job, unit.shard));
        writeFileSync(`${path}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
        renameSync(`${path}.tmp`, path);
      },
    },
    signal,
  );
  await release(outcome);
  log(`[run] ${event} run of ${commit}: ${verdicts[outcome.exitCode]}`);
  return outcome.exitCode;
}

/** The CI mirror's executors from this process's environment (scripts/ci/mirror-executor.ts). */
function onMirror(
  setup: ExecutorSetup,
  environment: Readonly<Record<string, string | undefined>>,
): Executors {
  const repository = environment.CI_MIRROR_REPO;
  const token = environment.CI_MIRROR_TOKEN;
  if (!repository || !token) throw new Error('CI_EXECUTOR=mirror needs CI_MIRROR_REPO and CI_MIRROR_TOKEN.');
  return mirrorExecutors(setup, {
    api: githubMirrorApi({ repository, token }),
    push: (commit, branch) =>
      pushMirrorCommit({
        repository: setup.source,
        remote: `https://github.com/${repository}.git`,
        commit,
        branch,
        token,
      }),
    // The orchestrator's own copy: a tested tree never chooses the workflow its jobs run under.
    workflow: readFileSync(join(setup.source, 'ci/mirror/workflow.yml'), 'utf8'),
    identity: mirrorIdentity(environment.CI_MIRROR_IDENTITY),
    now: () => Date.now(),
    sleep: (ms, signal) =>
      new Promise((resolveSleep) => {
        const timer = setTimeout(resolveSleep, ms);
        signal.addEventListener('abort', () => (clearTimeout(timer), resolveSleep(undefined)), {
          once: true,
        });
      }),
    pollMs: 20_000,
    jobCap: MIRROR_JOB_CAP,
  });
}

if (import.meta.main) {
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const)
    process.once(name, () => {
      console.info(`[run] ${name}: stopping every job, then Check`);
      controller.abort();
    });
  const environment = process.env;
  process.exit(
    await runCommitCommand({
      repository: ownRepository,
      environment,
      executors: (setup) => {
        if (environment.CI_EXECUTOR === 'mirror') return onMirror(setup, environment);
        if (environment.CI_EXECUTOR)
          throw new Error(`CI_EXECUTOR ${environment.CI_EXECUTOR} is no executor.`);
        return processExecutors(setup);
      },
      signal: controller.signal,
      log: (line) => console.info(line),
      error: (line) => console.error(line),
    }),
  );
}
