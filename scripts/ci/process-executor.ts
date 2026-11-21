// The executor of scripts/ci/run-commit.ts that runs each job as a process group on this host, in
// its own clone of the commit (lib/testing/ci/run-commit.ts names the interface; a container
// executor takes the same tasks later). Each job gets a fresh workspace: its clone, the sibling clones
// beside it, its log and the variables its environment steps pass on. Plan and Check share one
// workspace on the orchestrator's host. A job's clone shares the source's objects read-only and has
// its own .git, so no job writes the orchestrator's hooks, refs or configuration.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  log(line: string): void;
};

/** Variables of the orchestrator and its secrets: a job sees only the run's variables of its task. */
const NOT_FOR_JOBS =
  /^(CI_.*|GH_TOKEN|GITHUB_TOKEN|SIBLING_REPOSITORIES_TOKEN|SHRINK_ONLY_GROWTH_APPROVED|GITHUB_ENV|GITHUB_OUTPUT)$/;

/** The host's own environment without the orchestrator's variables. */
function hostEnvironment(): NodeJS.ProcessEnv {
  const host = { ...process.env };
  for (const name of Object.keys(host)) if (NOT_FOR_JOBS.test(name)) delete host[name];
  return host;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
};

/** Waits for the host's stack lock; a lock whose process died is taken over. Resolves to its release. */
async function lockStack(
  path: string,
  signal: AbortSignal,
  log: (line: string) => void,
): Promise<() => void> {
  for (let announced = false; ; ) {
    signal.throwIfAborted();
    try {
      const held = openSync(path, 'wx');
      writeFileSync(held, String(process.pid));
      closeSync(held);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    const holder = Number(readFileSync(path, 'utf8'));
    if (!Number.isInteger(holder) || !alive(holder)) {
      rmSync(path, { force: true });
      continue;
    }
    if (!announced) log(`[run] waiting for the host's stack, which process ${holder} holds`);
    announced = true;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      signal.addEventListener('abort', () => (clearTimeout(timer), resolve(undefined)), { once: true });
    });
  }
}

/** Runs a command as its own process group until it exits; `signal` ends the group. */
function runGroup(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; log: string },
  signal: AbortSignal,
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const output = openSync(options.log, 'a');
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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
    const stop = (): void => {
      signalGroup('SIGTERM');
      setTimeout(() => signalGroup('SIGKILL'), 10_000).unref();
    };
    signal.addEventListener('abort', stop, { once: true });
    child.once('error', () => resolve(null));
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop);
      resolve(code);
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

export function processExecutor(
  options: ProcessExecutorOptions,
): Executor & { workspace(unit: Unit): string } {
  const workspace = (unit: Unit): string =>
    join(options.root, unit.job === 'plan' || unit.job === 'check' ? 'host' : unitName(unit));
  const origin = originOf(options.source);
  return {
    workspace,
    async run(task, signal) {
      const began = Date.now();
      const name = unitName(task.unit);
      const folder = workspace(task.unit);
      const checkout = join(folder, 'werkflow-app');
      const log = join(folder, `${name}.log`);
      const ended = AbortSignal.any([signal, AbortSignal.timeout(task.timeoutMs)]);
      mkdirSync(folder, { recursive: true });
      const host = hostEnvironment();
      const run = (command: string, args: readonly string[], env: Record<string, string> = {}) =>
        runGroup(command, args, { cwd: checkout, env: { ...host, ...env }, log }, ended);
      const fail = (detail: string) => ({
        exitCode: null,
        detail: `${detail} after ${minutes(Date.now() - began)}${ended.aborted && !signal.aborted ? ', its timeout' : ''}; log ${log}`,
      });
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
        const steps: (readonly string[])[] = [
          ['fetch', '--quiet', '--no-tags', options.source, '+refs/remotes/origin/*:refs/remotes/origin/*'],
          ...(origin ? [['remote', 'set-url', 'origin', origin]] : []),
          ['checkout', '--quiet', '--detach', options.commit],
        ];
        for (const args of steps) if ((await run('git', args)) !== 0) return fail(`git ${args[0]} failed`);
      }
      const env: Record<string, string> = {
        ...task.env,
        // The runner began the job here, before its checkout and setup (lib/testing/ci/measurement.ts).
        CI_JOB_STARTED_AT: new Date(began).toISOString(),
        CI_MACHINE_START: String(options.machineStart),
      };
      const steps = CI_DAG[task.unit.job].prepare;
      const stack = steps.includes('stack') || steps.includes('stack-environment');
      let release: (() => void) | undefined;
      const passed = join(folder, `${name}.env`);
      // Only a stack this job started is stopped (prepare.ts reports it), before the host's lock
      // passes on: the next job's stack starts fresh, and a stack this job did not start stays.
      const freeStack = async (): Promise<void> => {
        if (!release) return;
        if (exported(passed).CI_STACK_STARTED === '1')
          await runGroup(
            'supabase',
            ['stop', '--no-backup'],
            { cwd: checkout, env: host, log },
            AbortSignal.timeout(120_000),
          );
        release();
        release = undefined;
      };
      try {
        if (stack) release = await lockStack(options.stackLock, ended, options.log);
        writeFileSync(passed, '');
        const prepared = await run(process.execPath, ['scripts/ci/prepare.ts', 'for', task.unit.job], {
          ...env,
          ...task.prepareEnv,
          GITHUB_ENV: passed,
          ...(options.replaceStack ? { CI_REPLACE_STACK: '1' } : {}),
        });
        if (prepared !== 0) return fail(`its environment steps ended with ${prepared ?? 'a stop'}`);
        const setup = Date.now() - began;
        // Fast reads only the stack's environment file, so only a job that uses the stack keeps it.
        if (!steps.includes('stack')) await freeStack();
        const variables = exported(passed);
        delete variables.CI_STACK_STARTED;
        const code = await run(process.execPath, ['scripts/ci/job.ts', task.unit.job], {
          ...env,
          ...variables,
        });
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
