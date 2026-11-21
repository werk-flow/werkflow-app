// The CI mirror executor of scripts/ci/run-commit.ts (Executors in lib/testing/ci/run-commit.ts):
// every job and shard but Plan and Check runs on GitHub's machines in the CI mirror, a public
// repository of its own with no link to this one: no app, webhook, secret or shared account. Each
// job start pushes one parentless commit of the tested tree (scripts/ci/mirror-push.ts) to
// `ci/<commit>-<run key>/<job>` (mirrorBranch), whose push runs the mirror's workflow
// (ci/mirror/workflow.yml);
// the executor waits for that run through the API, reads the job's result from its artifact, and
// writes it into the run's results directory only when it is this run's own (foreignResult in
// lib/testing/ci/mirror.ts). The run's branches are deleted once the run ended, and every `ci/**`
// branch older than a day at the first job start.
// Plan, Check and Fast's host part run on the orchestrator's host through the process executor:
// Fast's groups that read outside the tree (HOST_GROUPS in lib/testing/ci/dag.ts) need the sibling
// clones, one of them private, the base's history and GitHub's labels, which the mirror never gets,
// and the unit test files that read the history or the labels' approval (partUnitFiles) run there
// too, as the host's share of the unit group.
// These host jobs run the tested commit's code as the orchestrator's user, which can reach the
// ledger and this process's credentials: an accepted residual until the orchestrator computes them
// from main's code. The jobs on the mirror reach nothing of this host, so the executor counts as
// isolating, and a run through it may keep a ledger, come from the queue and post its Check.
// Configuration (scripts/ci/run-commit.ts reads it with CI_EXECUTOR=mirror):
//   CI_MIRROR_REPO      The mirror, `owner/name`. Never written into this repository.
//   CI_MIRROR_TOKEN     A fine-grained token for the mirror alone: Contents, Workflows and Actions
//                       read and write, Metadata read. Its default branch is locked; the token may
//                       create and delete `ci/**` branches only.
//   CI_MIRROR_IDENTITY  The mirror commits' author and committer, `Name <email>`; a neutral default.
// At most MIRROR_JOB_CAP (lib/testing/ci/mirror.ts) mirror jobs run at once on this host, every run
// together, each holding a slot under CI_WORK_ROOT/mirror-slots. A slot records the push its job
// tried, and when, until that push's run is known ended; a process that dies leaves the record, and
// the next taker of the slot waits for that push's run to start, cancels it and waits it out first.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPlanOf } from '../../lib/testing/ci/check';
import { CI_EVENTS, partGroups } from '../../lib/testing/ci/dag';
import {
  type ExpectedResult,
  foreignResult,
  joinFastParts,
  MIRROR_WORKFLOW,
  mirrorBranch,
  mirrorJobName,
  staleBranches,
} from '../../lib/testing/ci/mirror';
import { mirrorMessage, mirrorVariables } from '../../lib/testing/ci/mirror-message';
import { type CiResult, parseResult, readResult, resultFileName } from '../../lib/testing/ci/results';
import {
  type Executor,
  type ExecutorOutcome,
  type Executors,
  type ExecutorSetup,
  type ExecutorTask,
  unitName,
} from '../../lib/testing/ci/run-commit';
import { plannedGroups } from '../../lib/testing/ci/run-plan';
import type { MirrorApi, MirrorRun } from './mirror-api';
import { buildMirrorCommit, type MirrorIdentity } from './mirror-push';
import { processExecutors, takeLock } from './process-executor';

/** How long a pushed job may wait for a mirror machine, beyond its own timeout. */
const QUEUE_ALLOWANCE_MS = 30 * 60_000;
/** How long the mirror may take to start the push's run at all. */
const RUN_START_LIMIT_MS = 10 * 60_000;
/** How long the executor waits for a cancelled mirror run to be confirmed ended; past it, the slot stays held. */
const CANCEL_LIMIT_MS = 5 * 60_000;
/** API calls in a row that may fail while a job runs before the job fails. */
const POLL_FAILURES = 5;

export type MirrorOptions = {
  api: MirrorApi;
  /** Pushes `commit` to `branch` of the mirror (pushMirrorCommit). */
  push(commit: string, branch: string): void;
  /** The mirror's workflow, from the orchestrator's trusted copy: never the tested tree's. */
  workflow: string;
  identity: MirrorIdentity;
  now(): number;
  /** Resolves after `ms`, or at once when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  pollMs: number;
  /** The most mirror jobs this host runs at once, every run together: MIRROR_JOB_CAP. */
  jobCap: number;
};

type Finished = ExecutorOutcome & { result?: CiResult };

/** The one file of a result artifact's zip archive, or a throw for anything else. */
function archivedFile(bytes: Uint8Array, name: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'ci-mirror-artifact-'));
  try {
    const archive = join(folder, 'artifact.zip');
    writeFileSync(archive, bytes);
    const listed = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    if (listed.status !== 0) throw new Error('the artifact is no zip archive');
    const entries = listed.stdout.split('\n').filter(Boolean);
    if (entries.length !== 1 || entries[0] !== name)
      throw new Error(`the artifact holds ${entries.join(', ') || 'nothing'}, not ${name} alone`);
    const read = spawnSync('unzip', ['-p', archive, name], { maxBuffer: 1024 * 1024 });
    if (read.status !== 0) throw new Error(`${name} cannot be read from the artifact`);
    return read.stdout.toString('utf8');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Writes a result in place of the one at `path`, so a reader never sees half of it. */
function replaceResult(path: string, result: CiResult): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The mirror executors of one run: Plan, Check and Fast's host part here, every job on the mirror. */
export function mirrorExecutors(setup: ExecutorSetup, options: MirrorOptions): Executors {
  const { api } = options;
  const { log } = setup;
  const local = processExecutors(setup);
  /** This run's branches with the commit each holds, deleted once the run ended. */
  const branches = new Map<string, string>();
  // Read at the first job start: run-commit fetches the commit after it built the executors.
  let knownTree: string | undefined;
  const sourceTree = (): string => {
    if (knownTree) return knownTree;
    const treeOf = spawnSync('git', ['rev-parse', '--verify', `${setup.commit}^{tree}`], {
      cwd: setup.source,
      encoding: 'utf8',
    });
    if (treeOf.status !== 0) throw new Error(`The tree of ${setup.commit} cannot be read.`);
    knownTree = treeOf.stdout.trim();
    return knownTree;
  };
  /** One push at a time: a later push of the tree sends only its commit. */
  let pushes: Promise<unknown> = Promise.resolve();
  let swept: Promise<void> | undefined;

  /** Deletes every `ci/**` branch older than a day; a failure only warns. */
  async function sweep(): Promise<void> {
    try {
      const found = await api.ciBranches();
      const dated = await Promise.all(
        found
          .filter((branch) => !branches.has(branch.name))
          .map(async (branch) => ({
            name: branch.name,
            committedAt: await api.commit(branch.sha).then(
              (commit) => commit.committedAt,
              () => undefined,
            ),
          })),
      );
      const stale = staleBranches(dated, new Date(options.now()));
      for (const branch of stale) await api.deleteBranch(branch);
      if (stale.length) log(`[mirror] swept ${stale.length} branches older than a day`);
    } catch (error) {
      log(`[mirror] the sweep of old branches failed: ${message(error)}`);
    }
  }

  /** Where each slot's lock and the push its holder tried (`slot-<n>.push`) live. */
  const slots = join(setup.workRoot, 'mirror-slots');

  /** The push a slot's record names, or 'unreadable'. */
  function recordedPush(path: string): { branch: string; commit: string; at: number } | 'unreadable' {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'branch' in parsed &&
        'commit' in parsed &&
        typeof parsed.branch === 'string' &&
        typeof parsed.commit === 'string'
      )
        return {
          branch: parsed.branch,
          commit: parsed.commit,
          // A record without its push time counts from now: its run may still start.
          at: 'at' in parsed && typeof parsed.at === 'number' ? parsed.at : options.now(),
        };
    } catch {
      // Logged by the caller.
    }
    return 'unreadable';
  }

  /** A slot of the host's mirror job cap, waiting for one; undefined when `signal` stopped the wait. */
  async function slot(signal: AbortSignal): Promise<{ record: string; release: () => void } | undefined> {
    mkdirSync(slots, { recursive: true });
    for (let announced = false; !signal.aborted; ) {
      for (let index = 0; index < options.jobCap; index += 1) {
        const taken = takeLock(join(slots, `slot-${index}`));
        if (!('release' in taken)) continue;
        // A push its holder left unsettled, as when it died: its run is settled before the slot is reused.
        const record = join(slots, `slot-${index}.push`);
        const left = existsSync(record) ? recordedPush(record) : undefined;
        if (left === 'unreadable' || (left && !(await settled({ ...left, inFlight: true }, undefined)))) {
          log(`[mirror] slot ${index}: the run its last holder pushed may still go, so it stays out of use`);
          taken.release();
          continue;
        }
        rmSync(record, { force: true });
        return { record, release: taken.release };
      }
      if (!announced) log(`[mirror] waiting: ${options.jobCap} mirror jobs run on this host`);
      announced = true;
      await options.sleep(5_000, signal);
    }
    return undefined;
  }

  /** The run's facts from a job's environment and the run's Plan, or why the job cannot start. */
  function runOf(
    task: ExecutorTask,
  ):
    | { expected: ExpectedResult; plan: CiResult; outputs: Record<string, string>; resultsDir: string }
    | { problem: string } {
    const { env } = task;
    const event = CI_EVENTS.find((name) => name === env.CI_EVENT);
    const attempt = Number(env.CI_RUN_ATTEMPT);
    if (!event || !env.CI_RUN_URL || !env.CI_RESULTS_DIR || !Number.isInteger(attempt) || attempt < 1)
      return { problem: 'the job names no event, run, attempt or results directory' };
    const producer = env.CI_PRODUCER || null;
    const plan = runPlanOf(
      { tree: sourceTree(), event, runUrl: env.CI_RUN_URL, producer },
      readResult(join(env.CI_RESULTS_DIR, resultFileName('plan', null))),
    );
    if ('problem' in plan) return { problem: `no job runs by this plan: ${plan.problem}` };
    return {
      expected: {
        ...task.unit,
        event,
        commit: setup.commit,
        tree: sourceTree(),
        runUrl: env.CI_RUN_URL,
        attempt,
        producer,
        planIdentity: plan.identity,
      },
      plan: plan.result,
      outputs: plan.plan.outputs,
      resultsDir: env.CI_RESULTS_DIR,
    };
  }

  /** The mirror run of a pushed branch once it ended, or why there is none. */
  async function awaitRun(
    branch: string,
    commit: string,
    deadline: number,
    signal: AbortSignal,
  ): Promise<{ run: MirrorRun } | { stopped: string; run: MirrorRun | undefined }> {
    const pushedAt = options.now();
    let run: MirrorRun | undefined;
    for (let failures = 0; ; ) {
      if (signal.aborted) return { stopped: 'the job was stopped', run };
      if (options.now() > deadline) return { stopped: 'the job passed its timeout on the mirror', run };
      try {
        if (run) run = await api.run(run.id);
        else {
          const runs = (await api.runsOf(branch, commit)).filter(
            (candidate) =>
              candidate.path === MIRROR_WORKFLOW &&
              candidate.head_sha === commit &&
              candidate.head_branch === branch &&
              candidate.event === 'push',
          );
          if (runs.length > 1) return { stopped: `the mirror started ${runs.length} runs of ${branch}`, run };
          run = runs[0];
          if (!run && options.now() - pushedAt > RUN_START_LIMIT_MS)
            return { stopped: 'the mirror started no run of the push', run };
        }
        failures = 0;
      } catch (error) {
        failures += 1;
        log(
          `[mirror] ${branch}: the mirror could not be read (${failures} of ${POLL_FAILURES}): ${message(error)}`,
        );
        if (failures >= POLL_FAILURES) return { stopped: 'the mirror could not be read', run };
      }
      if (run?.status === 'completed') return { run };
      await options.sleep(options.pollMs, signal);
    }
  }

  /** The job's result from its mirror run, refused unless it is this run's own. */
  async function resultOf(run: MirrorRun, expected: ExpectedResult): Promise<CiResult | { refused: string }> {
    const name = unitName(expected);
    const artifacts = (await api.artifacts(run.id)).filter(
      (artifact) => artifact.name === `ci-result-${name}`,
    );
    const [artifact] = artifacts;
    if (artifacts.length !== 1 || !artifact || artifact.expired || artifact.workflow_run?.id !== run.id)
      return { refused: `the run holds ${artifacts.length} live result artifacts of ${name}` };
    let text: string;
    try {
      text = archivedFile(await api.download(artifact.id), resultFileName(expected.job, expected.shard));
    } catch (error) {
      return { refused: message(error) };
    }
    const result = parseResult(text);
    if (!result) return { refused: 'the artifact holds no valid result' };
    const foreign = foreignResult(result, expected);
    return foreign ? { refused: foreign } : result;
  }

  /**
   * Whether every run of a push ended: cancels the runs a stop, a timeout or a failure left going
   * and waits until they ended, or until the push started no run within RUN_START_LIMIT_MS. False
   * when that cannot be told within CANCEL_LIMIT_MS, or the mirror cannot be read: the job's slot
   * then stays held, so the cap never counts a run that may still go. A push `inFlight`, as one a
   * dead holder left, may still land: a branch without it counts only past RUN_START_LIMIT_MS.
   */
  async function settled(
    pushed: { branch: string; commit: string; at: number; inFlight?: boolean },
    known: MirrorRun | undefined,
  ): Promise<boolean> {
    const until = Math.max(pushed.at + RUN_START_LIMIT_MS, options.now() + CANCEL_LIMIT_MS);
    const cancelled = new Set<number>();
    try {
      for (;;) {
        const runs = known ? [await api.run(known.id)] : await api.runsOf(pushed.branch, pushed.commit);
        const going = runs.filter((run) => run.status !== 'completed');
        if (runs.length && !going.length) return true;
        // No run, and no branch holds the push: it never landed, so it started none.
        if (!runs.length && !pushed.inFlight && (await api.branchHead(pushed.branch)) !== pushed.commit)
          return true;
        if (!runs.length && options.now() - pushed.at > RUN_START_LIMIT_MS) return true;
        for (const run of going.filter((each) => !cancelled.has(each.id))) {
          await api.cancel(run.id);
          cancelled.add(run.id);
        }
        if (options.now() > until) return false;
        await options.sleep(options.pollMs, AbortSignal.timeout(CANCEL_LIMIT_MS));
      }
    } catch (error) {
      log(`[mirror] ${pushed.branch}: whether its run ended cannot be told: ${message(error)}`);
      return false;
    }
  }

  /** Runs one job start on the mirror and returns its outcome with its own result. */
  async function onMirror(
    task: ExecutorTask,
    started: { expected: ExpectedResult; plan: CiResult },
    signal: AbortSignal,
  ): Promise<Finished> {
    const { expected, plan } = started;
    const name = unitName(task.unit);
    const held = await slot(signal);
    if (!held) return { exitCode: null, detail: 'stopped before a mirror slot was free' };
    /** The push, once tried: from then on a run may go on the mirror until it is known ended. */
    let pushed: { branch: string; commit: string; at: number } | undefined;
    let known: MirrorRun | undefined;
    let ended = false;
    try {
      swept ??= sweep();
      await swept;
      const built = buildMirrorCommit({
        repository: setup.source,
        commit: setup.commit,
        workflow: options.workflow,
        identity: options.identity,
        message: mirrorMessage({
          version: 1,
          job: task.unit.job,
          shard: task.unit.shard,
          source: { commit: setup.commit, tree: expected.tree },
          variables: mirrorVariables(task.env),
          plan,
        }),
        date: new Date(options.now()),
      });
      if (built.sourceTree !== expected.tree) return { exitCode: null, detail: 'the source tree moved' };
      // Built before a slot was free or the sweep ended: a stop since pushes nothing.
      if (signal.aborted) return { exitCode: null, detail: 'the job was stopped before its push' };
      const branch = mirrorBranch(setup.commit, setup.runKey, task.unit);
      branches.set(branch, built.commit);
      pushed = { branch, commit: built.commit, at: options.now() };
      // Beside the slot until the push's run is known ended: a holder that dies leaves it to the next.
      // Renamed into place, so a holder that dies mid-write never leaves an unreadable record.
      writeFileSync(`${held.record}.tmp`, JSON.stringify({ branch, commit: built.commit, at: pushed.at }));
      renameSync(`${held.record}.tmp`, held.record);
      const push = pushes.then(() => options.push(built.commit, branch));
      pushes = push.catch(() => undefined);
      await push;
      // The mirror holds exactly the transformed tree this run pushed.
      const head = await api.branchHead(branch);
      if (head !== built.commit)
        return {
          exitCode: null,
          detail: `${branch} names ${head ?? 'nothing'}, not the pushed ${built.commit}`,
        };
      const mirrored = await api.commit(built.commit);
      if (mirrored.tree !== built.tree)
        return {
          exitCode: null,
          detail: `the mirror's tree ${mirrored.tree} is not the pushed tree ${built.tree}`,
        };
      log(`[mirror] ${name}: pushed ${built.commit} (tree ${built.tree}) to ${branch}`);
      const awaited = await awaitRun(
        branch,
        built.commit,
        options.now() + task.timeoutMs + QUEUE_ALLOWANCE_MS,
        signal,
      );
      if ('stopped' in awaited) {
        known = awaited.run;
        return { exitCode: null, detail: awaited.stopped };
      }
      const finished = awaited.run;
      ended = true;
      const firstAttempt = (run: MirrorRun): boolean =>
        run.run_attempt === 1 &&
        run.status === 'completed' &&
        run.head_sha === built.commit &&
        run.head_branch === branch &&
        run.path === MIRROR_WORKFLOW;
      if (!firstAttempt(finished))
        return {
          exitCode: null,
          detail: `the mirror ran it ${finished.run_attempt} times; only a first attempt counts`,
        };
      const jobs = await api.jobs(finished.id);
      const ran = jobs.filter((job) => job.name === mirrorJobName(task.unit));
      const others = jobs.filter(
        (job) => job.name !== mirrorJobName(task.unit) && job.conclusion !== 'skipped',
      );
      if (ran.length !== 1 || others.length)
        return { exitCode: null, detail: `the mirror run ran ${jobs.map((job) => job.name).join(', ')}` };
      const passed = finished.conclusion === 'success' && ran[0]?.conclusion === 'success';
      const own = await resultOf(finished, expected);
      if ('refused' in own) return { exitCode: 1, detail: `its result is refused: ${own.refused}` };
      // A rerun on the mirror keeps the run's id and its artifacts: the run is read again after them.
      if (!firstAttempt(await api.run(finished.id)))
        return {
          exitCode: null,
          detail: 'the mirror ran it again while its result was read; only a first attempt counts',
        };
      // A pass the mirror job did not end with is a failure, in the results directory too.
      const result: CiResult = passed || own.status !== 'passed' ? own : { ...own, status: 'failed' };
      return {
        exitCode: passed && result.status === 'passed' ? 0 : 1,
        detail: `${passed ? 'passed' : `ended ${finished.conclusion ?? 'without a conclusion'}`} on the mirror (run ${finished.id})`,
        result,
      };
    } catch (error) {
      return { exitCode: null, detail: `the mirror executor failed: ${message(error)}` };
    } finally {
      if (!pushed || ended || (await settled(pushed, known))) {
        rmSync(held.record, { force: true });
        held.release();
      } else
        log(
          `[mirror] ${name}: its run may still go, so its mirror slot stays held and recorded for the next holder`,
        );
    }
  }

  /** Fast's host part: the groups that read outside the tree, through the process executor here. */
  async function onHost(
    task: ExecutorTask,
    started: { expected: ExpectedResult; resultsDir: string },
    signal: AbortSignal,
  ): Promise<Finished> {
    const { expected } = started;
    const results = join(setup.workRoot, setup.runKey, 'fast-host-results');
    mkdirSync(results, { recursive: true });
    copyFileSync(
      join(started.resultsDir, resultFileName('plan', null)),
      join(results, resultFileName('plan', null)),
    );
    const outcome = await local.host.run(
      { ...task, env: { ...task.env, CI_PART: 'host', CI_RESULTS_DIR: results } },
      signal,
    );
    const written = readResult(join(results, resultFileName('fast', null)));
    if ('unreadable' in written) return outcome;
    const foreign = foreignResult(written, expected);
    return foreign
      ? { exitCode: 1, detail: `its host part's result is refused: ${foreign}` }
      : { ...outcome, result: written };
  }

  const jobs: Executor = {
    isolatesJobs: true,
    async run(task, signal) {
      const started = runOf(task);
      if ('problem' in started) return { exitCode: null, detail: started.problem };
      const target = join(started.resultsDir, resultFileName(task.unit.job, task.unit.shard));
      const planned = task.unit.job === 'fast' ? plannedGroups('fast', started.outputs) : [];
      const [tree, host] = await Promise.all([
        onMirror(task, started, signal),
        partGroups(planned, 'host').length ? onHost(task, started, signal) : undefined,
      ]);
      if (!host) {
        if (tree.result) replaceResult(target, tree.result);
        return { exitCode: tree.exitCode, detail: tree.detail };
      }
      const detail = `${tree.detail}; host part: ${host.detail}`;
      if (!tree.result || !host.result)
        return { exitCode: tree.exitCode === null || host.exitCode === null ? null : 1, detail };
      const joined = joinFastParts(
        {
          tree: { result: tree.result, passed: tree.exitCode === 0 },
          host: { result: host.result, passed: host.exitCode === 0 },
        },
        planned,
      );
      if ('problem' in joined) return { exitCode: 1, detail: `${detail}; ${joined.problem}` };
      replaceResult(target, joined);
      return {
        exitCode: tree.exitCode === 0 && host.exitCode === 0 && joined.status === 'passed' ? 0 : 1,
        detail,
      };
    },
  };

  return {
    // Plan and Check run the tested commit's code on this host: the residual the header names.
    host: { ...local.host, isolatesJobs: true },
    jobs,
    async release(outcome) {
      await local.release(outcome);
      // Only a branch that still holds this run's push: another holder's stays.
      for (const [branch, pushed] of branches)
        await api
          .branchHead(branch)
          .then((head) => (head === pushed ? api.deleteBranch(branch) : undefined))
          .catch((error: unknown) =>
            log(`[mirror] ${branch} could not be deleted; the next sweep takes it: ${message(error)}`),
          );
    },
  };
}
