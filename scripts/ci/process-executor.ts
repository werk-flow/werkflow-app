// The local and test executor of scripts/ci/run-commit.ts: it runs each job as a process group on
// this host, as run-commit's own user, in its own clone of the commit. It isolates nothing: a job can
// read and write whatever this user can. run-commit therefore refuses it whenever the run has a
// ledger, comes from the merge queue, posts its Check or holds a credential
// (isolationProblem in lib/testing/ci/run-commit.ts); CI runs through an executor that isolates each
// job, a container per job or a machine of its own (Executors in lib/testing/ci/run-commit.ts).
// Never run a job through it on the CI host under the CI account: the refusal sees configured
// variables, not that account's files (credentials, the ledger, the queue's state), which a local job
// could still read. The CI mirror executor (scripts/ci/mirror-executor.ts) runs only Plan, Check and
// Fast's host part through it there, the residual that executor's header names.
// Each job gets a fresh workspace: its clone, the sibling clones beside it, its log and the variables
// its environment steps pass on. Plan and Check share one workspace on the orchestrator's host. A
// job's clone shares the source's objects read-only and has its own .git, so no job writes the
// orchestrator's hooks, refs or configuration.
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { partOf, partSteps } from '../../lib/testing/ci/dag';
import { groupGone } from '../../lib/testing/local-stack/test-session';
import { errorCode } from '../../lib/testing/runner/error-code';
import { awaitAppPortFree, workspacePorts } from '../../lib/testing/runner/app-port';
import {
  type Executor,
  type Executors,
  type ExecutorOutcome,
  type ExecutorSetup,
  type ExecutorTask,
  type Unit,
  unitName,
} from '../../lib/testing/ci/run-commit';

type ProcessExecutorOptions = {
  /** The repository the job clones are made from; it holds the commit. */
  source: string;
  /** This run's folder of workspaces. */
  root: string;
  /**
   * A folder only the orchestrator writes, outside every workspace: the steps that hold a token
   * run there (the sibling clone).
   */
  trusted: string;
  commit: string;
  /** False on the orchestrator's host: Plan and Check start no machine of their own. */
  machineStart: boolean;
  /** CI_REPLACE_STACK for scripts/ci/prepare.ts: this host's Docker serves CI alone. */
  replaceStack: boolean;
  /** The host-wide lock of the one Supabase stack a host holds. */
  stackLock: string;
  /** Shared by this run's executors on this host: why no further job of the run may start here. */
  host: Host;
  log(line: string): void;
};

/** Why no further job of the run may start on this host; `refused` wakes every job that waits for its stack. */
type Host = { unverified?: string; readonly refused: AbortController };

/**
 * The host variables a job's tools need: NODE_ENV, the user, shell, temporary folder, locale and time
 * zone, the Docker socket the Supabase CLI reaches, and where Bun and Playwright live. A job gets these and its
 * task's variables, never the rest of this process's environment: a credential in the owner's shell
 * that no refusal names stays out of every job.
 */
const FOR_JOBS =
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TERM|TZ|LANG|LANGUAGE|LC_[A-Z]+|DOCKER_HOST|XDG_RUNTIME_DIR|BUN_INSTALL|PLAYWRIGHT_BROWSERS_PATH)$/;

/** The host variables of FOR_JOBS from this process's environment, and nothing else. */
function hostEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => FOR_JOBS.test(name))),
  };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

const holderOf = (path: string): number | undefined => {
  try {
    const holder = Number(readFileSync(path, 'utf8'));
    return Number.isInteger(holder) && holder > 0 ? holder : undefined;
  } catch {
    return undefined;
  }
};
/**
 * Creates `path` holding this process's id, or returns false when it exists. The id is written to a
 * file of its own first and linked into place, so a lock is never seen empty or half written.
 */
function create(path: string): boolean {
  const own = `${path}.${process.pid}`;
  writeFileSync(own, String(process.pid));
  try {
    linkSync(own, path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(own, { force: true });
  }
}

/**
 * Takes the lock at `path` for this process and returns its release, or the process that holds it.
 * A lock whose process died is taken over under a second lock, one taker at a time, and only while
 * it still names that dead process: two runners that both read the dead holder never both take it.
 */
export function takeLock(path: string): { release: () => void } | { holder: number | undefined } {
  const takeover = `${path}.takeover`;
  for (;;) {
    if (create(path)) return { release: () => rmSync(path, { force: true }) };
    const holder = holderOf(path);
    if (holder !== undefined && !alive(holder) && create(takeover)) {
      try {
        if (holderOf(path) === holder) rmSync(path, { force: true });
      } finally {
        rmSync(takeover, { force: true });
      }
      continue;
    }
    // A taker that died mid-takeover leaves its lock for a person: two runners that both read it
    // could each remove what the other just took.
    const taker = holderOf(takeover);
    if (taker !== undefined && !alive(taker))
      throw new Error(`${takeover} names process ${taker}, which died; remove it once no run-commit runs.`);
    return { holder };
  }
}

/**
 * Waits for the host's stack lock and resolves to its release, or to why no further job of the run
 * may start on this host once a job that held the lock left it unverified: that job keeps the lock,
 * so a waiting job would wait for ever.
 */
async function lockStack(
  path: string,
  signal: AbortSignal,
  host: Host,
  log: (line: string) => void,
): Promise<{ release: () => void } | { refused: string }> {
  for (let announced = false; ; ) {
    signal.throwIfAborted();
    if (host.unverified !== undefined) return { refused: host.unverified };
    const taken = takeLock(path);
    if ('release' in taken) return taken;
    const { holder } = taken;
    if (!announced) log(`[run] waiting for the host's stack, which process ${holder ?? 'unknown'} holds`);
    announced = true;
    const woken = AbortSignal.any([signal, host.refused.signal]);
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      woken.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
    });
  }
}

/**
 * Runs a command as its own process group until it exits; `signal` ends the group. `onSpawn` runs
 * once the command's process exists, never before; when it throws, the group is killed at once and
 * the command gives no exit code.
 */
function runGroup(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string; onSpawn?: () => void },
  signal: AbortSignal,
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const output = openSync(options.log, 'a');
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', output, output],
      detached: true,
    });
    closeSync(output);
    // The whole group: a job's own children outlive it otherwise. A group that is gone already is
    // no failure; a process the signal ended keeps a null exit code, so the code cannot tell. Any
    // other refusal (EPERM) fails the command once it closed, never this process.
    let unsignalled: unknown;
    const signalGroup = (name: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, name);
      } catch (error) {
        if (errorCode(error) !== 'ESRCH') unsignalled ??= error;
      }
    };
    let refused = false;
    child.once('spawn', () => {
      try {
        options.onSpawn?.();
      } catch {
        refused = true;
        signalGroup('SIGKILL');
      }
    });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      signalGroup('SIGTERM');
      escalation = setTimeout(() => signalGroup('SIGKILL'), 10_000);
    };
    signal.addEventListener('abort', stop, { once: true });
    child.once('error', () => resolve(null));
    // Every error of the cleanup after the close rejects the command: it never stays pending.
    const closed = async (code: number | null): Promise<number | null> => {
      signal.removeEventListener('abort', stop);
      clearTimeout(escalation);
      // Nothing of its group outlives it, on every path: the next job on this host would meet a
      // server it left behind. A stopped command never passes, whatever it exited with.
      signalGroup('SIGKILL');
      const exitCode = signal.aborted || refused ? null : code;
      const pid = child.pid;
      if (unsignalled !== undefined) {
        const reason = unsignalled instanceof Error ? unsignalled.message : String(unsignalled);
        throw new Error(`process group ${pid ?? 'unknown'} could not be signalled: ${reason}`);
      }
      if (pid !== undefined && !(await groupGone(pid)))
        appendFileSync(options.log, `Process group ${pid} is still listed 5 s after SIGKILL.\n`);
      return exitCode;
    };
    child.once('close', (code) => {
      closed(code).then(resolve, reject);
    });
  });
}

/** The `KEY=value` lines the environment steps passed on (GITHUB_ENV). */
function exported(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const index = line.indexOf('=');
        return index > 0 ? [[line.slice(0, index), line.slice(index + 1)]] : [];
      }),
  );
}

/** The source's `origin` without credentials, so no job reads a token from its clone's configuration. */
function originOf(source: string): string | undefined {
  const answer = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: source, encoding: 'utf8' });
  return answer.status === 0 ? answer.stdout.trim().replace(/^(https?:\/\/)[^@/]*@/, '$1') : undefined;
}

const minutes = (ms: number): string => `${(ms / 60_000).toFixed(1)} min`;

/**
 * The folder the token-holding steps run in: the orchestrator's alone. Created when missing, and
 * refused when it is a link or another user owns it.
 */
function trustedFolder(path: string): string {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const folder = lstatSync(path);
  if (!folder.isDirectory() || folder.uid !== process.getuid?.())
    throw new Error(`${path} is not run-commit's own folder.`);
  chmodSync(path, 0o700);
  return path;
}

function processExecutor(options: ProcessExecutorOptions): Executor & { workspace(unit: Unit): string } {
  const workspace = (unit: Unit): string =>
    join(options.root, unit.job === 'plan' || unit.job === 'check' ? 'host' : unitName(unit));
  const origin = originOf(options.source);
  return {
    workspace,
    // Every job runs as this process's user, who can write the ledger and read every credential.
    isolatesJobs: false,
    async run(task, signal) {
      if (options.host.unverified !== undefined)
        return { exitCode: null, detail: `not started: ${options.host.unverified}` };
      return runJob(task, signal);
    },
  };

  async function runJob(task: ExecutorTask, signal: AbortSignal): Promise<ExecutorOutcome> {
    const name = unitName(task.unit);
    const folder = workspace(task.unit);
    const checkout = join(folder, 'werkflow-app');
    const log = join(folder, `${name}.log`);
    const passed = join(folder, `${name}.env`);
    mkdirSync(folder, { recursive: true });
    const host = hostEnvironment();
    // Fast's host part for the CI mirror takes only its host steps (lib/testing/ci/dag.ts).
    const steps = partSteps(task.unit.job, partOf(task.env.CI_PART));
    let release: (() => void) | undefined;
    // The app port the browser job's test server serves (scripts/ci/job.ts), once the checkout
    // exists. No other job starts a server there, so no other job's port is probed.
    let port: number | undefined;
    let held: string | undefined;
    let began = Date.now();
    let ended = signal;
    const fail = (detail: string) => ({
      exitCode: null,
      detail: `${detail} after ${minutes(Date.now() - began)}${ended.aborted && !signal.aborted ? ', its timeout' : ''}; log ${log}`,
    });
    // What this job left that the next job on the host would meet, or undefined. Only a stack this
    // job started is stopped (prepare.ts reports it): the next job's stack starts fresh, and a stack
    // this job did not start stays. The browser job holds the lock while it serves the app port, so
    // a port held now is what it left, in its own group or one it started: never a server another
    // job still runs. The executor signals nothing it did not start.
    const leftover = async (): Promise<{ held: string; reason: string } | undefined> => {
      try {
        if (exported(passed).CI_STACK_STARTED === '1')
          await runGroup(
            'supabase',
            ['stop', '--no-backup'],
            { cwd: checkout, env: host, log },
            AbortSignal.timeout(120_000),
          );
      } catch (error) {
        return {
          held: "cleanup could not be verified: the stack's stop failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      if (port === undefined) return undefined;
      const probed = port;
      return awaitAppPortFree(probed).then(
        () => undefined,
        (error: unknown) => ({
          held: `cleanup could not be verified: port ${probed} is still held`,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    // The lock passes on only from a host proven clean; otherwise it stays taken and every further
    // start of the run on this host is refused.
    const freeStack = async (): Promise<void> => {
      if (!release || held !== undefined) return;
      const left = await leftover();
      if (left !== undefined) {
        held = left.held;
        options.host.unverified = held;
        options.host.refused.abort();
        options.log(`[run] ${name}: ${held}, so the host's stack lock stays taken: ${left.reason}`);
        return;
      }
      release();
      release = undefined;
    };
    const outcome = await (async (): Promise<ExecutorOutcome> => {
      try {
        // The host's one stack first: a job's time, as ci.yml's timeout counts it, starts once it runs.
        if (steps.includes('stack') || steps.includes('stack-environment')) {
          const taken = await lockStack(options.stackLock, signal, options.host, options.log);
          if ('refused' in taken) return { exitCode: null, detail: `not started: ${taken.refused}` };
          release = taken.release;
        }
        began = Date.now();
        ended = AbortSignal.any([signal, AbortSignal.timeout(task.timeoutMs)]);
        const run = (
          command: string,
          args: readonly string[],
          env: Readonly<Record<string, string | undefined>> = {},
          onSpawn?: () => void,
        ) =>
          runGroup(
            command,
            args,
            { cwd: checkout, env: { ...host, ...env }, log, ...(onSpawn ? { onSpawn } : {}) },
            ended,
          );
        if (!existsSync(checkout)) {
          if (
            (await runGroup(
              'git',
              ['clone', '--quiet', '--shared', '--no-checkout', options.source, checkout],
              { cwd: folder, env: host, log },
              ended,
            )) !== 0
          )
            return fail('the clone failed');
          // The job reads `origin` as on GitHub Actions: the source's view of GitHub's branches, and
          // GitHub itself for a newer head (job.ts) or an open PR's migrations.
          const gitSteps: (readonly string[])[] = [
            ['fetch', '--quiet', '--no-tags', options.source, '+refs/remotes/origin/*:refs/remotes/origin/*'],
            ...(origin ? [['remote', 'set-url', 'origin', origin]] : []),
            ['checkout', '--quiet', '--detach', options.commit],
          ];
          for (const args of gitSteps)
            if ((await run('git', args)) !== 0) return fail(`git ${args[0]} failed`);
        }
        if (task.unit.job === 'browser') port = workspacePorts(checkout).app;
        const env: Record<string, string> = {
          ...task.env,
          // The runner began the job here, before its checkout and setup (lib/testing/ci/measurement.ts).
          CI_JOB_STARTED_AT: new Date(began).toISOString(),
          CI_MACHINE_START: String(options.machineStart),
          GITHUB_ENV: passed,
        };
        writeFileSync(passed, '');
        // The sibling clones take a token, so the trusted copy's prepare.ts clones them: the tested
        // commit's steps, its install scripts included, never hold it and find the clones in place.
        // It runs from the orchestrator's own folder, never one a job writes, with only what it
        // needs, and Bun reads no bunfig.toml or .env file there into the process that holds the token.
        if (steps.includes('siblings')) {
          const trusted = join(options.source, 'scripts/ci/prepare.ts');
          const minimal: NodeJS.ProcessEnv = { NODE_ENV: host.NODE_ENV, PATH: host.PATH, HOME: host.HOME };
          const cloned = await runGroup(
            process.execPath,
            ['--config=/dev/null', '--no-env-file', trusted, 'siblings'],
            {
              cwd: trustedFolder(options.trusted),
              env: { ...minimal, ...task.prepareEnv, CI_CHECKOUT: checkout, GITHUB_ENV: passed },
              log,
            },
            ended,
          );
          if (cloned !== 0) return fail(`the sibling clones ended with ${cloned ?? 'a stop'}`);
        }
        const prepared = await run(process.execPath, ['scripts/ci/prepare.ts', 'for', task.unit.job], {
          ...env,
          ...(options.replaceStack ? { CI_REPLACE_STACK: '1' } : {}),
        });
        if (prepared !== 0) return fail(`its environment steps ended with ${prepared ?? 'a stop'}`);
        const setup = Date.now() - began;
        // Fast reads only the stack's environment file, so only a job that uses the stack keeps it.
        if (!steps.includes('stack')) {
          await freeStack();
          if (held !== undefined) return fail('its stack was not freed before its body');
        }
        // The body gets what the steps passed on, never the file they wrote it to.
        const variables: Record<string, string> = { ...env, ...exported(passed) };
        delete variables.CI_STACK_STARTED;
        delete variables.GITHUB_ENV;
        // The task learns of the launch once the body's process exists: a body that never launched
        // is never reported launched. A launch that cannot be recorded ends the body at once.
        let unrecorded: string | undefined;
        const code = await run(process.execPath, ['scripts/ci/job.ts', task.unit.job], variables, () => {
          try {
            task.onLaunch?.();
          } catch (error) {
            unrecorded = error instanceof Error ? error.message : String(error);
            throw error;
          }
        });
        if (unrecorded !== undefined) return fail(`its launch could not be recorded: ${unrecorded}`);
        return code === null
          ? fail('the job was stopped')
          : {
              exitCode: code,
              detail: `${code === 0 ? 'passed' : `failed (exit ${code})`} in ${minutes(Date.now() - began)}, setup ${minutes(setup)}; log ${log}`,
            };
      } catch (error) {
        return fail(`the executor failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    await freeStack();
    return held === undefined
      ? outcome
      : {
          exitCode: null,
          detail: `${held} after it ended, so no further job of this run starts on this host (${outcome.detail})`,
        };
  }
}

/**
 * Plan and Check on this host and every other job as a process here, each in a workspace of the run
 * under the work root. Passed jobs' workspaces are removed once the run ends, and the whole run's
 * after a pass; a failed job's stays with its log.
 */
export function processExecutors(setup: ExecutorSetup): Executors {
  const root = join(setup.workRoot, setup.runKey);
  // Plan, Check and every job of the run share this host, so a host one of them left dirty refuses all.
  const host: Host = { refused: new AbortController() };
  const executor = (machineStart: boolean) =>
    processExecutor({
      host,
      source: setup.source,
      root,
      commit: setup.commit,
      machineStart,
      replaceStack: setup.replaceStack,
      stackLock: join(setup.workRoot, 'stack.lock'),
      trusted: join(setup.workRoot, 'trusted'),
      log: setup.log,
    });
  const jobs = executor(true);
  return {
    host: executor(false),
    jobs,
    release(outcome) {
      for (const { unit, state } of outcome.units) {
        const folder = jobs.workspace(unit);
        if (state === 'passed') rmSync(folder, { recursive: true, force: true });
        else if (existsSync(folder))
          setup.log(`[run] ${unitName(unit)} ${state}: its workspace stays at ${folder}`);
      }
      if (outcome.exitCode === 0) rmSync(root, { recursive: true, force: true });
    },
  };
}
