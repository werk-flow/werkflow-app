// The executor of scripts/ci/run-commit.ts that runs each job as a process group on this host, in
// its own clone of the commit (lib/testing/ci/run-commit.ts names the interface; a container
// executor takes the same tasks later). Each job gets a fresh workspace: its clone, the sibling clones
// beside it, its log and the variables its environment steps pass on. Plan and Check share one
// workspace on the orchestrator's host. A job's clone shares the source's objects read-only and has
// its own .git, so no job writes the orchestrator's hooks, refs or configuration.
//
// Every command of the tested commit runs as the job user, never as the orchestrator's: through
// `sudo -n -H -u <job user> --preserve-env=<names> -- /usr/bin/env PATH=<path> <command>`, which one
// fixed sudoers rule allows (`<runner> ALL=(<job user>) NOPASSWD:SETENV: /usr/bin/env`). The job
// gets only its task's variables and a short list of the host's (HOST_VARIABLES), so no job reaches
// the orchestrator's files (the queue's state, its ledger, its publisher) or its tokens. The variable
// values travel in sudo's environment, never in an argument another user could read.
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CI_DAG } from '../../lib/testing/ci/dag';
import { type Executor, type Unit, unitName } from '../../lib/testing/ci/run-commit';

export type ProcessExecutorOptions = {
  /** The repository the job clones are made from; it holds the commit. */
  source: string;
  /** This run's folder of workspaces. */
  root: string;
  commit: string;
  /** False on the orchestrator's host: Plan and Check start no machine of their own. */
  machineStart: boolean;
  /** CI_REPLACE_STACK for scripts/ci/prepare.ts: this host's Docker serves CI alone. */
  replaceStack: boolean;
  /** The host-wide lock of the one Supabase stack a host holds. */
  stackLock: string;
  /** The user every job runs as: never the orchestrator's own, never root. */
  jobUser: string;
  log(line: string): void;
};

/**
 * The host variables a job takes, beside its task's: the tools' path, the locale and Docker. Its
 * home is the job user's (`sudo -H`); nothing else of the orchestrator passes.
 */
const HOST_VARIABLES = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'DOCKER_HOST'] as const;

/** The allowed host variables, and git's leave to read the clones the orchestrator owns. */
function hostEnvironment(): Record<string, string> {
  const host: Record<string, string> = {};
  for (const name of HOST_VARIABLES) {
    const value = process.env[name];
    if (value) host[name] = value;
  }
  // The job's clone borrows the trusted clone's objects, and the sibling clones are the
  // orchestrator's: git reads repositories of another user only when told to.
  return { ...host, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
}

/** A command as the job user, with exactly `env` (PATH in the arguments, the values in sudo's environment). */
function asJobUser(
  jobUser: string,
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { command: string; args: string[]; env: Record<string, string> } {
  const variables = Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  );
  const path = variables.PATH ?? '/usr/bin:/bin';
  const kept = Object.keys(variables).filter((name) => name !== 'PATH');
  return {
    command: 'sudo',
    args: [
      '-n',
      '-H',
      '-u',
      jobUser,
      ...(kept.length ? [`--preserve-env=${kept.join(',')}`] : []),
      '--',
      '/usr/bin/env',
      `PATH=${path}`,
      command,
      ...args,
    ],
    env: { ...variables, PATH: path },
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
 * Waits for the host's stack lock and resolves to its release. A lock whose process died is taken
 * over under a second lock, one taker at a time, and only while it still names that dead process:
 * two runners that both read the dead holder never both take it.
 */
async function lockStack(
  path: string,
  signal: AbortSignal,
  log: (line: string) => void,
): Promise<() => void> {
  const takeover = `${path}.takeover`;
  for (let announced = false; ; ) {
    signal.throwIfAborted();
    if (create(path)) return () => rmSync(path, { force: true });
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
    if (!announced) log(`[run] waiting for the host's stack, which process ${holder ?? 'unknown'} holds`);
    announced = true;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
    });
  }
}

/** The first line a command prints, or undefined. */
const firstLine = (command: string, args: readonly string[]): string | undefined =>
  spawnSync(command, args, { encoding: 'utf8' }).stdout?.trim().split('\n')[0]?.trim() || undefined;

/**
 * The process group of the job user's command under `sudo` (process `pid`): sudo passes SIGTERM on
 * to it, but SIGKILL only reaches the job user's processes from the job user.
 */
function jobGroupOf(pid: number): string | undefined {
  const command = firstLine('pgrep', ['-P', String(pid)]);
  return command && firstLine('ps', ['-o', 'pgid=', '-p', command]);
}

/**
 * Runs a command as its own process group until it exits; `signal` ends the group. With `jobUser`,
 * the command runs as that user (asJobUser), and a stop kills that user's group as that user.
 */
function runGroup(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: Readonly<Record<string, string | undefined>>; log: string; jobUser?: string },
  signal: AbortSignal,
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  const { jobUser } = options;
  const started = jobUser
    ? asJobUser(jobUser, command, args, options.env)
    : { command, args: [...args], env: options.env };
  return new Promise((resolve) => {
    const output = openSync(options.log, 'a');
    const child = spawn(started.command, started.args, {
      cwd: options.cwd,
      // sudo resets its environment and passes on only the kept names; NODE_ENV is never one.
      env: { NODE_ENV: process.env.NODE_ENV, ...started.env },
      stdio: ['ignore', output, output],
      detached: true,
    });
    closeSync(output);
    // The whole group: a job's own children outlive it otherwise. A group that is gone already is
    // no failure; a process the signal ended keeps a null exit code, so the code cannot tell.
    const signalGroup = (name: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, name);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    };
    let jobGroup: string | undefined;
    const killJobGroup = (): void => {
      signalGroup('SIGKILL');
      if (jobUser && jobGroup)
        spawnSync(
          'sudo',
          ['-n', '-u', jobUser, '--', '/usr/bin/env', 'kill', '-KILL', '--', `-${jobGroup}`],
          {
            stdio: 'ignore',
          },
        );
    };
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      // Found while sudo still runs: after it, nothing names the job user's group.
      if (jobUser && child.pid !== undefined) jobGroup = jobGroupOf(child.pid);
      signalGroup('SIGTERM');
      escalation = setTimeout(killJobGroup, 10_000);
    };
    signal.addEventListener('abort', stop, { once: true });
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop);
      clearTimeout(escalation);
      // A stopped command never passes, whatever it exited with, and nothing of its group outlives it.
      if (signal.aborted) {
        killJobGroup();
        resolve(null);
      } else resolve(code);
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
 * Refuses a job user that is this process's own user or root: a job would reach the orchestrator's
 * files and tokens again.
 */
export function jobUserProblem(jobUser: string | undefined): string | undefined {
  if (!jobUser) return 'CI_JOB_USER names the user every job runs as: required.';
  // By the user id: a name from the environment ($USER) proves nothing.
  const id = spawnSync('id', ['-u', jobUser], { encoding: 'utf8' });
  const uid = id.status === 0 ? Number(id.stdout.trim()) : undefined;
  if (uid === undefined || !Number.isInteger(uid)) return `CI_JOB_USER ${jobUser} is no user of this host.`;
  if (uid === 0 || uid === process.getuid?.())
    return `CI_JOB_USER ${jobUser} is the user run-commit runs as, or root: every job runs as a user of its own.`;
  return undefined;
}

/** A folder every job user writes to; the sticky bit keeps each file its owner's. */
function sharedFolder(path: string): void {
  mkdirSync(path, { recursive: true });
  chmodSync(path, 0o1777);
}

export function processExecutor(options: ProcessExecutorOptions): Executor & {
  workspace(unit: Unit): string;
  /** Removes a folder of the run's workspaces, the job user's files first. */
  remove(folder: string): void;
} {
  const problem = jobUserProblem(options.jobUser);
  if (problem) throw new Error(problem);
  const { jobUser } = options;
  const workspace = (unit: Unit): string =>
    join(options.root, unit.job === 'plan' || unit.job === 'check' ? 'host' : unitName(unit));
  const origin = originOf(options.source);
  return {
    workspace,
    remove(folder) {
      if (!existsSync(folder)) return;
      spawnSync('sudo', ['-n', '-u', jobUser, '--', '/usr/bin/env', 'rm', '-rf', '--', folder], {
        stdio: 'ignore',
      });
      rmSync(folder, { recursive: true, force: true });
    },
    // The jobs run as the job user, who cannot write the ledger. Plan and Check still run the tested
    // commit's job.ts, which reads and appends the ledger itself, so a run keeps none until the
    // orchestrator holds Plan's and Check's ledger work (lib/testing/ci/run-commit.ts).
    isolatesJobs: false,
    async run(task, signal) {
      const name = unitName(task.unit);
      const folder = workspace(task.unit);
      const checkout = join(folder, 'werkflow-app');
      const log = join(folder, `${name}.log`);
      const passed = join(folder, `${name}.env`);
      sharedFolder(options.root);
      sharedFolder(folder);
      const host = hostEnvironment();
      const steps = CI_DAG[task.unit.job].prepare;
      let release: (() => void) | undefined;
      let began = Date.now();
      let ended = signal;
      const fail = (detail: string) => ({
        exitCode: null,
        detail: `${detail} after ${minutes(Date.now() - began)}${ended.aborted && !signal.aborted ? ', its timeout' : ''}; log ${log}`,
      });
      // Only a stack this job started is stopped (prepare.ts reports it), before the host's lock
      // passes on: the next job's stack starts fresh, and a stack this job did not start stays.
      const freeStack = async (): Promise<void> => {
        if (!release) return;
        if (exported(passed).CI_STACK_STARTED === '1')
          await runGroup(
            'supabase',
            ['stop', '--no-backup'],
            { cwd: checkout, env: host, log, jobUser },
            AbortSignal.timeout(120_000),
          );
        release();
        release = undefined;
      };
      try {
        // The host's one stack first: a job's time, as ci.yml's timeout counts it, starts once it runs.
        if (steps.includes('stack') || steps.includes('stack-environment'))
          release = await lockStack(options.stackLock, signal, options.log);
        began = Date.now();
        ended = AbortSignal.any([signal, AbortSignal.timeout(task.timeoutMs)]);
        const run = (
          command: string,
          args: readonly string[],
          env: Readonly<Record<string, string | undefined>> = {},
        ) => runGroup(command, args, { cwd: checkout, env: { ...host, ...env }, log, jobUser }, ended);
        if (!existsSync(checkout)) {
          if (
            (await runGroup(
              'git',
              ['clone', '--quiet', '--shared', '--no-checkout', options.source, checkout],
              { cwd: folder, env: host, log, jobUser },
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
        const env: Record<string, string> = {
          ...task.env,
          // The runner began the job here, before its checkout and setup (lib/testing/ci/measurement.ts).
          CI_JOB_STARTED_AT: new Date(began).toISOString(),
          CI_MACHINE_START: String(options.machineStart),
          GITHUB_ENV: passed,
        };
        writeFileSync(passed, '');
        chmodSync(passed, 0o666);
        // The sibling clones take a token, so the trusted copy's prepare.ts clones them, as the
        // orchestrator: no process of the job user ever holds the token, and the job user reads the
        // clones. The tested commit's steps, its install scripts included, find them in place.
        // It runs from the workspace folder, never the tested checkout, whose bunfig.toml and .env
        // files Bun would load into the process that holds the token, with only what it needs.
        if (steps.includes('siblings')) {
          const trusted = join(options.source, 'scripts/ci/prepare.ts');
          const { NODE_ENV, PATH, HOME } = process.env;
          const minimal = { NODE_ENV, PATH, HOME };
          const cloned = await runGroup(
            process.execPath,
            [trusted, 'siblings'],
            {
              cwd: folder,
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
        if (!steps.includes('stack')) await freeStack();
        // The body gets what the steps passed on, never the file they wrote it to.
        const variables: Record<string, string> = { ...env, ...exported(passed) };
        delete variables.CI_STACK_STARTED;
        delete variables.GITHUB_ENV;
        const code = await run(process.execPath, ['scripts/ci/job.ts', task.unit.job], variables);
        return code === null
          ? fail('the job was stopped')
          : {
              exitCode: code,
              detail: `${code === 0 ? 'passed' : `failed (exit ${code})`} in ${minutes(Date.now() - began)}, setup ${minutes(setup)}; log ${log}`,
            };
      } catch (error) {
        return fail(`the executor failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await freeStack();
      }
    },
  };
}
