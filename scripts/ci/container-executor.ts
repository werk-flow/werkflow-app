// The container executor of scripts/ci/run-commit.ts (Executors in lib/testing/ci/run-commit.ts) on
// the owner's machines: every job, Plan and Check included, runs in a container of its own on the
// machine's slot (lib/testing/ci/container-slot.ts), and run-commit, its results directory, the
// publisher and every credential stay on this, the trusted side. A job start:
//   1. The trusted side clones the sibling repositories with its copy of scripts/ci/prepare.ts
//      (the private one with SIBLING_REPOSITORIES_TOKEN) and reads GitHub's labels and the open
//      PRs' migrations into a snapshot (lib/testing/ci/github-snapshot.ts). A missing sibling fails
//      the job: a local run tests what GitHub Actions tests.
//   2. It streams them, with the run's results so far, as a tar into the slot, where
//      `werkflow-ci-stage` (ci/image) clones the commit from the slot's git cache of GitHub.
//   3. The job's container runs `werkflow-ci-job <job>`: the commit's own prepare.ts steps, then
//      scripts/ci/job.ts. Its environment is container-slot.ts's allowlist, so no token enters it.
//   4. Once the container ended, the job's result is read back from the slot, kept only when it is
//      this run's own (foreignResult), and written into the run's results directory here.
// A job that started a Supabase stack has it stopped and the slot checked clean before the next
// job may start; a slot that cannot be shown clean refuses every further job of the run.
// The slot's commands run through `SlotShell`, which scripts/ci/machine-runner.ts builds from the
// machine's configuration; run-commit takes it with CI_EXECUTOR=container (scripts/ci/run-commit.ts).
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { runPlanOf } from '../../lib/testing/ci/check';
import {
  containerName,
  docker,
  jobCommand,
  jobEnvironment,
  type SlotConfig,
  stackListCommand,
  stageCommand,
  stopCommand,
  workspaceOf,
} from '../../lib/testing/ci/container-slot';
import { CI_EVENTS, partSteps } from '../../lib/testing/ci/dag';
import { type GitHubSnapshot, squashedPullRequests } from '../../lib/testing/ci/github-snapshot';
import { pullRequestsOf } from '../../lib/testing/ci/measurement';
import { openPullRequestMigrations } from '../../lib/testing/local-stack/migration-order';
import { type ExpectedResult, foreignResult } from '../../lib/testing/ci/mirror';
import { type CiResult, parseResult, type PlanIdentity, resultFileName } from '../../lib/testing/ci/results';
import {
  type Executor,
  type ExecutorOutcome,
  type Executors,
  type ExecutorSetup,
  type ExecutorTask,
  unitName,
} from '../../lib/testing/ci/run-commit';
import { replaceResult } from './mirror-executor';

/** Runs a command on the slot host behind its prefix. It never throws for a non-zero exit. */
export type SlotShell = (
  argv: readonly string[],
  options?: { input?: Buffer; logFile?: string },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export type ContainerOptions = {
  slot: SlotConfig;
  shell: SlotShell;
  /** The machine runner's generation, which labels every job container (restart cleanup). */
  generation: number;
  /** The snapshot of GitHub a job reads in place of GitHub (github-snapshot.ts). */
  snapshot(task: ExecutorTask): Promise<GitHubSnapshot>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

/**
 * The environment of every command behind the slot's prefix: enough to find `docker` or `wsl.exe`,
 * nothing of the runner's own. WSLENV is emptied, so Windows hands no variable on into the slot's
 * distribution.
 */
export function slotEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = { WSLENV: '' };
  for (const name of ['PATH', 'HOME', 'WSL_INTEROP', 'WSL_DISTRO_NAME']) {
    const value = environment[name];
    if (value) kept[name] = value;
  }
  return kept;
}

/** The slot's shell: each command behind the prefix, with `slotEnvironment` only. */
export function slotShell(slot: SlotConfig): SlotShell {
  return (argv, options = {}) =>
    new Promise((resolve) => {
      const [command, ...args] = [...slot.prefix, ...argv];
      if (command === undefined) throw new Error('A slot command names no program.');
      const log = options.logFile === undefined ? undefined : openSync(options.logFile, 'a');
      const child = spawn(command, args, {
        env: { NODE_ENV: process.env.NODE_ENV, ...slotEnvironment(process.env) },
        stdio: [options.input ? 'pipe' : 'ignore', log ?? 'pipe', log ?? 'pipe'],
      });
      if (log !== undefined) closeSync(log);
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.stdin?.end(options.input);
      child.once('error', (error) => resolve({ code: null, stdout, stderr: error.message }));
      child.once('close', (code) => resolve({ code, stdout, stderr }));
    });
}

/** What a job's result must name; `planIdentity` null for Plan and Check, which name none. */
type Expected = Omit<ExpectedResult, 'planIdentity'> & { planIdentity: PlanIdentity | null };

/** Why `result` is not the job's own result of this run, or undefined. */
function refusal(result: CiResult, expected: Expected): string | undefined {
  if (expected.planIdentity !== null)
    return foreignResult(result, { ...expected, planIdentity: expected.planIdentity });
  if (result.planIdentity !== undefined) return 'it names a Plan identity, which Plan and Check never do';
  // Every other field must still be this run's: the comparison takes the Plan identity out.
  const none: PlanIdentity = {
    runUrl: null,
    attempt: null,
    startedAt: result.startedAt,
    base: null,
    digest: '0'.repeat(64),
  };
  return foreignResult({ ...result, planIdentity: none }, { ...expected, planIdentity: none });
}

/** How often a running job is asked whether its body launched. */
const LAUNCH_POLL_MS = 5_000;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The `KEY=value` lines a job's steps passed on. */
const exportsOf = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split('\n').flatMap((line) => {
      const index = line.indexOf('=');
      return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
    }),
  );

/** A tar of `folder`'s entries, for a slot's standard input. */
function tarOf(folder: string): Buffer {
  const packed = spawnSync('tar', ['-C', folder, '-cf', '-', '.'], { maxBuffer: 2 * 1024 ** 3 });
  if (packed.status !== 0) throw new Error(`tar of ${folder} failed: ${packed.stderr.toString('utf8')}`);
  return packed.stdout;
}

export function containerExecutors(setup: ExecutorSetup, options: ContainerOptions): Executors {
  const { slot, shell } = options;
  const local = join(setup.workRoot, setup.runKey);
  /** Why no further job of the run may start on the slot: a job left it in a state not shown clean. */
  let unverified: string | undefined;
  const workspaces: string[] = [];
  const treeOf = (): string => {
    const answer = spawnSync('git', ['rev-parse', `${setup.commit}^{tree}`], {
      cwd: setup.source,
      encoding: 'utf8',
    });
    if (answer.status !== 0) throw new Error(`${setup.commit} has no tree in ${setup.source}.`);
    return answer.stdout.trim();
  };
  const must = async (argv: readonly string[], input?: Buffer): Promise<string> => {
    const result = await shell(argv, input ? { input } : {});
    if (result.code !== 0)
      throw new Error(`${argv.slice(0, 4).join(' ')} … exited ${result.code}: ${result.stderr.trim()}`);
    return result.stdout;
  };
  /** A file of the slot host, or undefined when it is missing. */
  const read = async (path: string): Promise<string | undefined> => {
    const result = await shell(['sh', '-c', 'test -e "$1" && cat "$1"', 'read', path]);
    return result.code === 0 ? result.stdout : undefined;
  };

  /** The trusted side's inputs of one job: sibling clones, the results so far, the snapshot. */
  async function stage(task: ExecutorTask, stageFolder: string): Promise<Record<string, string>> {
    rmSync(stageFolder, { recursive: true, force: true });
    const checkout = join(stageFolder, 'werkflow-app');
    mkdirSync(checkout, { recursive: true });
    mkdirSync(join(stageFolder, 'results'));
    const exported = join(stageFolder, 'job.env');
    writeFileSync(exported, '');
    if (partSteps(task.unit.job, undefined).includes('siblings')) {
      // The trusted copy of the step, from this clone, never the tested one: it holds the token.
      const cloned = spawnSync(
        process.execPath,
        ['--config=/dev/null', '--no-env-file', join(setup.source, 'scripts/ci/prepare.ts'), 'siblings'],
        {
          cwd: stageFolder,
          env: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            ...task.prepareEnv,
            CI_CHECKOUT: checkout,
            GITHUB_ENV: exported,
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        },
      );
      if (cloned.status !== 0) throw new Error(`the sibling clones ended with ${cloned.status ?? 'a stop'}`);
      const unreadable = exportsOf(readFileSync(exported, 'utf8')).WERKFLOW_UNREADABLE_SIBLINGS;
      if (unreadable)
        throw new Error(
          `${unreadable} could not be cloned: a local run reads every sibling, as GitHub Actions does. Give the runner SIBLING_REPOSITORIES_TOKEN.`,
        );
    }
    // The run's results so far: every job after Plan reads plan.json, and Check reads them all.
    const results = task.env.CI_RESULTS_DIR;
    if (results && existsSync(results))
      for (const file of readdirSync(results).filter((name) => name.endsWith('.json')))
        writeFileSync(join(stageFolder, 'results', file), readFileSync(join(results, file)));
    writeFileSync(join(stageFolder, 'github-snapshot.json'), JSON.stringify(await options.snapshot(task)));
    rmSync(checkout, { recursive: true });
    return exportsOf(readFileSync(exported, 'utf8'));
  }

  /**
   * What a job's result must name to be kept: this run, attempt, commit and tree, and the identity
   * of the run's Plan. Plan and Check name no Plan identity (results.ts): null.
   */
  function expectedOf(task: ExecutorTask, tree: string): Expected | { problem: string } {
    const event = CI_EVENTS.find((name) => name === task.env.CI_EVENT);
    const attempt = Number(task.env.CI_RUN_ATTEMPT);
    const runUrl = task.env.CI_RUN_URL;
    if (!event || !runUrl || !Number.isInteger(attempt) || attempt < 1)
      return { problem: 'the job names no event, run or attempt' };
    const producer = task.env.CI_PRODUCER || null;
    const own = { ...task.unit, event, commit: setup.commit, tree, runUrl, attempt, producer };
    if (task.unit.job === 'plan' || task.unit.job === 'check') return { ...own, planIdentity: null };
    const results = task.env.CI_RESULTS_DIR;
    const planFile = results ? join(results, resultFileName('plan', null)) : undefined;
    const planResult =
      planFile && existsSync(planFile)
        ? (parseResult(readFileSync(planFile, 'utf8')) ?? { unreadable: 'plan.json does not parse' })
        : { unreadable: 'no plan.json' };
    const plan = runPlanOf({ tree, event, runUrl, producer }, planResult);
    if ('problem' in plan) return { problem: `no job runs by this plan: ${plan.problem}` };
    return { ...own, planIdentity: plan.identity };
  }

  /**
   * Removes the stack a job left and shows the slot clean, or says why it is not. The slot's Docker
   * serves CI alone, so every Supabase container on it is a job's.
   */
  async function freeStack(workspace: string): Promise<string | undefined> {
    const exported = exportsOf((await read(`${workspace}/job.env`)) ?? '');
    if (exported.CI_STACK_STARTED !== '1') return undefined;
    const listed = await shell(stackListCommand(slot));
    if (listed.code !== 0) return `the slot's containers could not be listed: ${listed.stderr.trim()}`;
    const left = listed.stdout.trim();
    if (!left) return undefined;
    await shell(['sh', '-c', 'exec "$@" $(cat)', 'remove', ...docker(slot, 'rm', '--force')], {
      input: Buffer.from(left),
    });
    const again = await shell(stackListCommand(slot));
    return again.code === 0 && again.stdout.trim() === ''
      ? undefined
      : `the stack's containers are still on the slot: ${again.stdout.trim() || again.stderr.trim()}`;
  }

  async function runJob(
    task: ExecutorTask,
    signal: AbortSignal,
    machineStart: boolean,
  ): Promise<ExecutorOutcome> {
    if (unverified !== undefined) return { exitCode: null, detail: `not started: ${unverified}` };
    const name = unitName(task.unit);
    const began = Date.now();
    const workspace = workspaceOf(slot, setup.runKey, task.unit);
    const container = containerName(setup.runKey, task.unit);
    const log = join(local, `${name}.log`);
    mkdirSync(local, { recursive: true });
    const ended = AbortSignal.any([signal, AbortSignal.timeout(task.timeoutMs)]);
    const minutes = (): string => `${((Date.now() - began) / 60_000).toFixed(1)} min`;
    const fail = (detail: string): ExecutorOutcome => ({
      exitCode: null,
      detail: `${detail} after ${minutes()}${ended.aborted && !signal.aborted ? ', its timeout' : ''}; log ${log}`,
    });
    const tree = treeOf();
    const expected = expectedOf(task, tree);
    if ('problem' in expected) return fail(expected.problem);
    try {
      const stageFolder = join(local, `stage-${name}`);
      const passed = await stage(task, stageFolder);
      workspaces.push(workspace);
      await must(['sh', '-c', 'rm -rf "$1" && mkdir -p "$1"', 'clear', workspace]);
      // The steps' variables start with what the trusted sibling step passed on.
      writeFileSync(
        join(stageFolder, 'job.env'),
        Object.entries(passed)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
      await must(
        stageCommand(slot, { workspace, commit: setup.commit, repository: task.env.GITHUB_REPOSITORY ?? '' }),
        tarOf(stageFolder),
      );
      rmSync(stageFolder, { recursive: true, force: true });
      if (ended.aborted) return fail('the job was stopped');
      const environment = jobEnvironment(task, workspace, {
        jobStartedAt: new Date(began).toISOString(),
        machineStart,
      });
      const finished = shell(
        jobCommand(slot, {
          name: container,
          generation: options.generation,
          workspace,
          environment,
          unit: task.unit,
        }),
        { logFile: log },
      );
      // A stop or the timeout stops the container: SIGTERM, a grace, then SIGKILL (container-slot.ts).
      const stop = (): void => void shell(stopCommand(slot, container));
      ended.addEventListener('abort', stop, { once: true });
      let launched = false;
      let unrecorded: string | undefined;
      const watch = new AbortController();
      const watching = (async () => {
        while (!launched && !watch.signal.aborted) {
          await options.sleep(LAUNCH_POLL_MS, watch.signal);
          if (watch.signal.aborted) return;
          if ((await shell(['test', '-e', `${workspace}/launched`])).code !== 0) continue;
          launched = true;
          try {
            task.onLaunch?.();
          } catch (error) {
            unrecorded = message(error);
            stop();
          }
        }
      })();
      const exit = await finished;
      watch.abort();
      await watching;
      ended.removeEventListener('abort', stop);
      // A body that launched between the last poll and its end launched too.
      if (!launched && (await shell(['test', '-e', `${workspace}/launched`])).code === 0) {
        launched = true;
        task.onLaunch?.();
      }
      const left = await freeStack(workspace);
      if (left !== undefined) unverified = left;
      if (unrecorded !== undefined) return fail(`its launch could not be recorded: ${unrecorded}`);
      if (ended.aborted) return fail('the job was stopped');
      if (!launched) return fail(`its environment steps ended with ${exit.code ?? 'a stop'}`);
      const target = task.env.CI_RESULTS_DIR;
      const text = await read(`${workspace}/results/${resultFileName(task.unit.job, task.unit.shard)}`);
      const result = text === undefined ? undefined : parseResult(text);
      if (target && result) {
        const foreign = refusal(result, expected);
        if (foreign) return { exitCode: 1, detail: `its result is refused: ${foreign}; log ${log}` };
        replaceResult(join(target, resultFileName(task.unit.job, task.unit.shard)), result);
      }
      if (exit.code === null) return fail('the job was stopped');
      return {
        exitCode: exit.code,
        detail: `${exit.code === 0 ? 'passed' : `failed (exit ${exit.code})`} in ${minutes()}${left ? `; ${left}` : ''}; log ${log}`,
      };
    } catch (error) {
      return fail(`the executor failed: ${message(error)}`);
    }
  }

  const executor = (machineStart: boolean): Executor => ({
    isolatesJobs: true,
    run: (task, signal) => runJob(task, signal, machineStart),
  });
  return {
    host: executor(false),
    jobs: executor(true),
    async release(outcome) {
      // A failed job's workspace stays on the slot for a person; the rest go.
      for (const { unit, state } of outcome.units) {
        const workspace = workspaceOf(slot, setup.runKey, unit);
        if (state === 'passed' && workspaces.includes(workspace))
          await shell(['rm', '-rf', workspace]).catch(() => undefined);
        else if (workspaces.includes(workspace))
          setup.log(`[run] ${unitName(unit)} ${state}: its workspace stays on the slot at ${workspace}`);
      }
      if (outcome.exitCode === 0) rmSync(local, { recursive: true, force: true });
    },
  };
}

/**
 * GitHub as a job of `task` reads it, through this side's own `gh` login: the labels of the run's
 * PRs and of the PRs an integration commit squashes, and the open PRs' migrations. A label list
 * that cannot be read throws, so the job fails rather than read no approval.
 */
export function githubSnapshot(source: string, commit: string, task: ExecutorTask): GitHubSnapshot {
  const read = (command: string, args: readonly string[]): string => {
    const answer = spawnSync(command, args, { cwd: source, encoding: 'utf8' });
    if (answer.status !== 0)
      throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${answer.stderr.trim()}`);
    return answer.stdout.trim();
  };
  const named = pullRequestsOf(task.env.CI_PRS);
  if ('unreadable' in named) throw new Error(named.unreadable);
  const base = task.env.CI_BASE_SHA;
  const squashed =
    task.env.CI_EVENT === 'integration' && base
      ? squashedPullRequests(read('git', ['log', '--format=%s', `${base}..${commit}`]))
      : [];
  const repository = task.env.GITHUB_REPOSITORY;
  const labels: Record<string, string[]> = {};
  for (const pr of new Set([...named, ...squashed])) {
    if (!repository) throw new Error('The snapshot needs GITHUB_REPOSITORY.');
    labels[String(pr)] = read('gh', [
      'api',
      '--paginate',
      `repos/${repository}/issues/${pr}/labels`,
      '--jq',
      '.[].name',
    ])
      .split('\n')
      .filter(Boolean);
  }
  return { labels, openMigrations: openPullRequestMigrations(source) };
}
