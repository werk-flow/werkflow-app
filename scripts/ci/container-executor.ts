// The container executor of scripts/ci/run-commit.ts (Executors in lib/testing/ci/run-commit.ts) on
// the owner's machines: every job, Plan and Check included, runs in a container of its own on the
// machine's slot (lib/testing/ci/container-slot.ts), and run-commit, its results directory and every
// credential stay on this, the trusted side. A job start:
//   1. The trusted side clones the sibling repositories with its copy of scripts/ci/prepare.ts (the
//      private werkflow-business with SIBLING_REPOSITORIES_TOKEN) and reads GitHub's labels and the
//      open PRs' migrations into a snapshot (lib/testing/ci/github-snapshot.ts). werkflow-business
//      never enters a job: its part of docs:check runs here, the trusted checkout's own check bundled
//      and run against the PR's files as data (`businessProblems`).
//   2. It streams the public sibling, the run's results so far and the snapshot as a tar into the
//      slot, where `werkflow-ci-stage` (ci/image) clones the commit from the slot's git cache.
//   3. The job's container runs `werkflow-ci-job <job>`: the commit's own prepare.ts steps, then
//      scripts/ci/job.ts. Its environment is container-slot.ts's allowlist, so no token enters it.
//   4. Once the container ended, the job's result is read back (a regular file, size-bounded, with
//      a deadline), kept only when it is this run's own (foreignResult), and written into the run's
//      results directory here. Any Supabase stack on the slot is removed and the slot shown clean
//      before the next job; a slot that cannot be shown clean refuses every further job of the run.
// Every job of a run works at one slot path, so a browser shard unpacks Fast's build where Fast
// built it (CI_BUILD_TAR); a job's workspace then moves aside under the run's folder.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { runPlanOf } from '../../lib/testing/ci/check';
import {
  docker,
  jobCommand,
  jobEnvironment,
  keptOf,
  READ_LIMIT_BYTES,
  readCommand,
  runFolder,
  type SlotConfig,
  stageCommand,
  stopCommand,
  TEARDOWN_MS,
  containerName,
  workspaceOf,
} from '../../lib/testing/ci/container-slot';
import { CI_EVENTS, partSteps } from '../../lib/testing/ci/dag';
import type { GitHubSnapshot } from '../../lib/testing/ci/github-snapshot';
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
import { openPullRequestMigrations } from '../../lib/testing/local-stack/migration-order';
import { z } from '../../lib/zod';
import { replaceResult } from './mirror-executor';

/** Runs a command on the slot host behind its prefix. It never throws; a command past its deadline is killed and has no code. */
export type SlotShell = (
  argv: readonly string[],
  options?: { input?: Buffer; logFile?: string; timeoutMs?: number },
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export type ContainerOptions = {
  slot: SlotConfig;
  shell: SlotShell;
  /** The snapshot of GitHub a job reads in place of GitHub (github-snapshot.ts). */
  snapshot(task: ExecutorTask): Promise<GitHubSnapshot>;
  /** The problems the trusted docs check finds in werkflow-business for the PR's files (`businessProblems`). */
  businessCheck(checkout: string): string[];
  /** Clones the sibling repositories beside `checkout` with the trusted step (`trustedSiblings`). */
  siblings(task: ExecutorTask, checkout: string, exported: string): void;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

/** How often a running job is asked whether its body launched. */
const LAUNCH_POLL_MS = 5_000;
/** How long a stop waits before it asks docker again while the job's container runs on. */
const STOP_RETRY_MS = 5_000;
/** Each phase's deadline on the slot: a command, the staging, a read. */
const COMMAND_MS = 120_000;
const STAGE_MS = 20 * 60_000;

const READ_MS = 60_000;

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

/**
 * The environment of every command behind the slot's prefix: enough to find `docker`, `colima` or
 * `wsl.exe`, nothing of the runner's own. WSLENV is emptied, so Windows hands no variable on into the
 * slot's distribution.
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

/** The slot's shell: each command behind the prefix, with `slotEnvironment` only, killed at its deadline. */
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
      const timer =
        options.timeoutMs === undefined
          ? undefined
          : setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
      // The bytes first, decoded once: a character split across two chunks stays whole.
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
      const text = (chunks: Buffer[]): string => Buffer.concat(chunks).toString('utf8');
      child.stdin?.end(options.input);
      child.once('error', (error) => resolve({ code: null, stdout: text(out), stderr: error.message }));
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({
          code: signal ? null : code,
          stdout: text(out),
          stderr: signal ? `${text(err)}\nkilled at its deadline` : text(err),
        });
      });
    });
}

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
  const workspace = workspaceOf(slot, setup.runKey);
  /** Why no further job of the run may start on the slot: a job left it in a state not shown clean. */
  let unverified: string | undefined;
  const kept: string[] = [];
  const treeOf = (): string => {
    const answer = spawnSync('git', ['rev-parse', `${setup.commit}^{tree}`], {
      cwd: setup.source,
      encoding: 'utf8',
    });
    if (answer.status !== 0) throw new Error(`${setup.commit} has no tree in ${setup.source}.`);
    return answer.stdout.trim();
  };
  const must = async (argv: readonly string[], input?: Buffer, timeoutMs = COMMAND_MS): Promise<string> => {
    const result = await shell(argv, { ...(input ? { input } : {}), timeoutMs });
    if (result.code !== 0)
      throw new Error(
        `${argv.slice(0, 4).join(' ')} … exited ${result.code ?? 'at its deadline'}: ${result.stderr.trim()}`,
      );
    return result.stdout;
  };
  /** A regular file of the slot of bounded size, or undefined when there is none. */
  const read = async (path: string): Promise<string | undefined> => {
    const result = await shell(readCommand(path), { timeoutMs: READ_MS });
    return result.code === 0 && Buffer.byteLength(result.stdout) <= READ_LIMIT_BYTES
      ? result.stdout
      : undefined;
  };

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

  async function runJob(
    task: ExecutorTask,
    signal: AbortSignal,
    machineStart: boolean,
  ): Promise<ExecutorOutcome> {
    if (unverified !== undefined) return { exitCode: null, detail: `not started: ${unverified}` };
    const name = unitName(task.unit);
    const began = Date.now();
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
    const target = keptOf(slot, setup.runKey, task.unit);
    try {
      const stageFolder = join(local, `stage-${name}`);
      try {
        await stageInputs({ source: setup.source, commit: setup.commit, task, folder: stageFolder, options });
      } catch (error) {
        if (error instanceof BusinessProblems)
          return {
            exitCode: 1,
            detail: `docs:check of werkflow-business failed: ${error.problems.join('; ')}; log ${log}`,
          };
        throw error;
      }
      await must(['sh', '-c', 'rm -rf "$1" && mkdir -p "$1"', 'clear', workspace]);
      await must(
        stageCommand(slot, {
          runKey: setup.runKey,
          commit: setup.commit,
          repository: task.env.GITHUB_REPOSITORY ?? '',
          image: slot.image,
        }),
        tarOf(join(stageFolder, 'inputs')),
        STAGE_MS,
      );
      rmSync(stageFolder, { recursive: true, force: true });
      if (ended.aborted) return fail('the job was stopped');
      const environment = jobEnvironment(slot, task, setup.runKey, {
        jobStartedAt: new Date(began).toISOString(),
        machineStart,
      });
      const container = containerName(setup.runKey, task.unit);
      // A stop or the timeout stops the container: SIGTERM, a grace, then SIGKILL (container-slot.ts).
      // The stop repeats until the job ended, so a stop that came before docker created the
      // container still ends it. It listens before the job starts, so no stop falls between.
      let exited = false;
      const stop = (): void =>
        void (async () => {
          while (!exited) {
            await shell(stopCommand(slot, container), { timeoutMs: COMMAND_MS });
            if (!exited) await options.sleep(STOP_RETRY_MS, new AbortController().signal);
          }
        })();
      ended.addEventListener('abort', stop, { once: true });
      const finished = shell(
        jobCommand(slot, {
          runKey: setup.runKey,
          environment,
          unit: task.unit,
          image: slot.image,
        }),
        { logFile: log },
      ).finally(() => {
        exited = true;
      });
      let launched = false;
      let unrecorded: string | undefined;
      // Both launch reports go through here: a report that cannot be recorded stops the job and
      // fails it, and never skips the slot's cleanup below.
      const recordLaunch = (): void => {
        launched = true;
        try {
          task.onLaunch?.();
        } catch (error) {
          unrecorded = message(error);
          stop();
        }
      };
      const watch = new AbortController();
      const marker = `${workspace}/launched`;
      const watching = (async () => {
        while (!launched && !watch.signal.aborted) {
          await options.sleep(LAUNCH_POLL_MS, watch.signal);
          if (watch.signal.aborted) return;
          if ((await shell(['test', '-e', marker], { timeoutMs: COMMAND_MS })).code === 0) recordLaunch();
        }
      })();
      const exit = await finished;
      watch.abort();
      await watching;
      ended.removeEventListener('abort', stop);
      // A body that launched between the last poll and its end launched too.
      if (!launched && (await shell(['test', '-e', marker], { timeoutMs: COMMAND_MS })).code === 0)
        recordLaunch();
      // Every container the job left, its Supabase stack too, goes before the next job.
      const left = await clearSlot(shell, slot);
      if (left !== undefined) unverified = left;
      const text = await read(`${workspace}/results/${resultFileName(task.unit.job, task.unit.shard)}`);
      // The workspace moves aside, so the next job of the run gets the one path empty.
      await must(['sh', '-c', 'rm -rf "$2" && mv "$1" "$2"', 'keep', workspace, target]);
      kept.push(target);
      if (unrecorded !== undefined) return fail(`its launch could not be recorded: ${unrecorded}`);
      if (ended.aborted) return fail('the job was stopped');
      if (!launched) return fail(`its environment steps ended with ${exit.code ?? 'a stop'}`);
      const results = task.env.CI_RESULTS_DIR;
      const result = text === undefined ? undefined : parseResult(text);
      if (results && result) {
        const foreign = refusal(result, expected);
        if (foreign) return { exitCode: 1, detail: `its result is refused: ${foreign}; log ${log}` };
        replaceResult(join(results, resultFileName(task.unit.job, task.unit.shard)), result);
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
      // A failed job's workspace stays on the slot for a person; the rest go. The runner empties
      // the slot's daemon after the run (clearSlot).
      for (const { unit, state } of outcome.units) {
        const target = keptOf(slot, setup.runKey, unit);
        if (!kept.includes(target)) continue;
        if (state === 'passed') await shell(['rm', '-rf', target], { timeoutMs: COMMAND_MS });
        else setup.log(`[run] ${unitName(unit)} ${state}: its workspace stays on the slot at ${target}`);
      }
      if (outcome.exitCode === 0) {
        await shell(['rm', '-rf', runFolder(slot, setup.runKey)], { timeoutMs: COMMAND_MS });
        rmSync(local, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Removes every container and every volume on the slot's daemon, its Supabase stack's database
 * included, then shows them gone; the pinned image stays. The daemon serves CI alone, one run at a time, so whatever it holds is a run's: a job's
 * container, its staging, its Supabase stack, also one a job started before it could record it. One
 * deadline covers the whole teardown. Undefined once the slot is empty, otherwise why not.
 */
export async function clearSlot(shell: SlotShell, slot: SlotConfig): Promise<string | undefined> {
  const deadline = Date.now() + TEARDOWN_MS;
  const ids = async (...args: string[]): Promise<string[]> => {
    const listed = await shell(docker(slot, ...args), { timeoutMs: Math.max(1_000, deadline - Date.now()) });
    if (listed.code !== 0) throw new Error(`docker ${args.join(' ')} failed: ${listed.stderr.trim()}`);
    return listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  };
  const remove = async (...args: string[]): Promise<void> => {
    const removed = await shell(docker(slot, ...args), { timeoutMs: Math.max(1_000, deadline - Date.now()) });
    if (removed.code !== 0)
      throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${removed.stderr.trim()}`);
  };
  try {
    const containers = await ids('ps', '--all', '--quiet');
    if (containers.length) await remove('rm', '--force', ...containers);
    const listedVolumes = await ids('volume', 'ls', '--quiet');
    if (listedVolumes.length) await remove('volume', 'rm', '--force', ...listedVolumes);
    const left = [...(await ids('ps', '--all', '--quiet')), ...(await ids('volume', 'ls', '--quiet'))];
    return left.length ? `the slot still holds ${left.join(', ')}` : undefined;
  } catch (error) {
    return `the slot could not be shown empty: ${message(error)}`;
  }
}

/**
 * The trusted side's inputs of one job, in `folder`/inputs for the slot: the public sibling, the
 * results so far, the GitHub snapshot and the variables to pass on. werkflow-business is cloned and
 * checked here and never staged: the job is told it is unreadable, and this side's check stands for it.
 */
export async function stageInputs(input: {
  source: string;
  commit: string;
  task: ExecutorTask;
  folder: string;
  options: Pick<ContainerOptions, 'snapshot' | 'businessCheck' | 'siblings'>;
}): Promise<void> {
  const { task, folder, options } = input;
  rmSync(folder, { recursive: true, force: true });
  const inputs = join(folder, 'inputs');
  mkdirSync(join(inputs, 'results'), { recursive: true });
  const passed: Record<string, string> = {};
  if (partSteps(task.unit.job, undefined).includes('siblings')) {
    // The PR's files, as data, beside the sibling clones. Without symbolic links: a link checks out
    // as a file holding its target's name, so the check never reads through one.
    const checkout = join(folder, 'werkflow-app');
    for (const args of [
      [
        'clone',
        '--quiet',
        '--shared',
        '--no-checkout',
        '--config',
        'core.symlinks=false',
        input.source,
        checkout,
      ],
      ['-C', checkout, 'checkout', '--quiet', '--detach', input.commit],
    ])
      if (spawnSync('git', args, { stdio: 'ignore', timeout: COMMAND_MS }).status !== 0)
        throw new Error(`git ${args[0]} of the docs checkout failed`);
    const exported = join(folder, 'siblings.env');
    writeFileSync(exported, '');
    options.siblings(task, checkout, exported);
    if (exportsOf(readFileSync(exported, 'utf8')).WERKFLOW_UNREADABLE_SIBLINGS)
      throw new Error(
        'werkflow-business could not be cloned: a local run checks every sibling, as GitHub Actions does. Give the runner SIBLING_REPOSITORIES_TOKEN.',
      );
    const problems = options.businessCheck(checkout);
    if (problems.length) throw new BusinessProblems(problems);
    cpSync(join(folder, 'werkflow-website'), join(inputs, 'werkflow-website'), { recursive: true });
    // The job checks werkflow-business no more: this side did, with its own code.
    passed.WERKFLOW_UNREADABLE_SIBLINGS = 'werkflow-business';
  }
  // The run's results so far: every job after Plan reads plan.json, and Check reads them all.
  const results = task.env.CI_RESULTS_DIR;
  if (results && existsSync(results))
    for (const file of readdirSync(results).filter((name) => name.endsWith('.json')))
      copyFileSync(join(results, file), join(inputs, 'results', file));
  writeFileSync(join(inputs, 'github-snapshot.json'), JSON.stringify(await options.snapshot(task)));
  writeFileSync(
    join(inputs, 'job.env'),
    Object.entries(passed)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  );
}

/** The trusted copy of prepare.ts's sibling step, from `source`, never the tested one: it holds the token. */
export function trustedSiblings(
  source: string,
  task: ExecutorTask,
  checkout: string,
  exported: string,
): void {
  const cloned = spawnSync(
    process.execPath,
    ['--config=/dev/null', '--no-env-file', join(source, 'scripts/ci/prepare.ts'), 'siblings'],
    {
      cwd: dirname(checkout),
      timeout: STAGE_MS,
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
}

/** werkflow-business problems the trusted docs check found in the PR's files. */
class BusinessProblems extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

const reportSchema = z.object({ problems: z.array(z.string()) });

/**
 * The part of docs:check that reads werkflow-business, run on the trusted side: the trusted
 * checkout's scripts/check-docs.ts, bundled into one file in this side's own folder, run with the
 * PR's checkout as its root (WERKFLOW_DOCS_ROOT), as data, and with no credential in its environment.
 * Nothing is written into the checkout. The check must write its report; a check that fails to
 * start, outruns its deadline, ends otherwise or leaves no report throws, so Fast fails. Only its
 * problems that name werkflow-business count; the job checks the rest.
 */
export function businessProblems(
  source: string,
  bundleFolder: string,
  checkout: string,
  timeoutMs = COMMAND_MS,
): string[] {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
    timeout: COMMAND_MS,
  }).stdout.trim();
  const bundle = join(bundleFolder, `check-docs-${commit}.js`);
  if (!existsSync(bundle)) {
    mkdirSync(bundleFolder, { recursive: true });
    const built = spawnSync(
      process.execPath,
      ['build', join(source, 'scripts/check-docs.ts'), '--target=bun', '--outfile', bundle],
      {
        cwd: source,
        encoding: 'utf8',
        timeout: COMMAND_MS,
      },
    );
    if (built.status !== 0)
      throw new Error(`the trusted docs check could not be bundled: ${built.stderr.trim()}`);
  }
  const report = join(bundleFolder, `report-${process.pid}.json`);
  rmSync(report, { force: true });
  const ran = spawnSync(process.execPath, ['--config=/dev/null', '--no-env-file', bundle], {
    cwd: bundleFolder,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      WERKFLOW_DOCS_ROOT: checkout,
      WERKFLOW_DOCS_REPORT: report,
    },
  });
  if (ran.error || (ran.status !== 0 && ran.status !== 1) || !existsSync(report))
    throw new Error(
      `the trusted docs check gave no report (${ran.error?.message ?? `exit ${ran.status ?? ran.signal}`})`,
    );
  const { problems } = reportSchema.parse(JSON.parse(readFileSync(report, 'utf8')));
  rmSync(report, { force: true });
  return problems.filter((problem) => problem.includes('werkflow-business'));
}

/**
 * GitHub as a job of `task` reads it: the approval the machine runner captured at admission
 * (SHRINK_ONLY_GROWTH_APPROVED), never a later label or a commit subject, and the open PRs'
 * migrations through this side's own `gh` login.
 */
export function githubSnapshot(source: string, task: ExecutorTask): GitHubSnapshot {
  return {
    approved: task.env.SHRINK_ONLY_GROWTH_APPROVED === 'true',
    openMigrations: openPullRequestMigrations(source),
  };
}
