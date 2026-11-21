// The process executor of scripts/ci/run-commit.ts (scripts/ci/process-executor.ts), on a throwaway
// repository whose prepare.ts and job.ts record what they see: each job runs as the job user in its
// own clone of the commit, its body never sees the orchestrator's variables or the sibling token, the
// variables its environment steps pass on reach the body, a job ends at its timeout, and only a stack
// the job started is stopped before the host's stack lock passes on. A stub `sudo` records each call
// and runs the command as this user.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launcherProblem, processExecutor } from '../../../scripts/ci/process-executor';
import type { ExecutorTask } from './run-commit';

let folder = '';
let source = '';
let commit = '';
const saved = { ...process.env };

// Each stub writes its environment's CI and token variables to <folder>/<script>-<job>.env.
const RECORD = (script: string) => `
import { appendFileSync, writeFileSync } from 'node:fs';
const job = process.argv.at(-1);
const seen = Object.entries(process.env).filter(([name]) => /^(CI_|GH_TOKEN|SIBLING_|SHRINK_|EMAIL_|GITHUB_ENV|QUEUE_|HOME$)/.test(name)).sort();
writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/${script}-' + job + '.env', [...seen, ['CWD', process.cwd()]].map(([name, value]) => name + '=' + value).join('\\n'));
`;
const PREPARE = `${RECORD('prepare')}
if (process.env.STARTS_STACK === '1') appendFileSync(process.env.GITHUB_ENV, 'CI_STACK_STARTED=1\\n');
if (process.env.PASS_PATH) appendFileSync(process.env.GITHUB_ENV, 'PATH=' + process.env.PASS_PATH + '\\n');
appendFileSync(process.env.GITHUB_ENV, 'SHRINK_ONLY_GROWTH_APPROVED=true\\n');
`;
// The body takes what the steps passed on as the real job.ts does (CI_PASSED_ENV), then records.
const JOB = `const { applyPassedVariables } = await import(${JSON.stringify(join(import.meta.dir, 'passed-variables.ts'))});
applyPassedVariables(process.env);
${RECORD('job')}
if (process.env.HANG === '1') await Bun.sleep(60_000);
process.exit(Number(process.env.EXIT ?? '0'));
`;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'process-executor-'));
  source = join(folder, 'source');
  mkdirSync(join(source, 'scripts/ci'), { recursive: true });
  writeFileSync(join(source, 'scripts/ci/prepare.ts'), PREPARE);
  writeFileSync(join(source, 'scripts/ci/job.ts'), JOB);
  // The tested commit's Bun configuration preloads a script into every Bun process run from its
  // checkout; it records whether that process held the sibling token.
  writeFileSync(join(source, 'bunfig.toml'), 'preload = ["./preload.ts"]\n');
  writeFileSync(
    join(source, 'preload.ts'),
    `require('node:fs').appendFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/preload.log', (process.env.SIBLING_REPOSITORIES_TOKEN ? 'token' : 'none') + '\\n');\n`,
  );
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', ...args],
      {
        cwd: source,
        encoding: 'utf8',
      },
    ).trim();
  git('init', '--quiet', '--initial-branch=main');
  git('add', '.');
  git('commit', '--quiet', '-m', 'stubs');
  commit = git('rev-parse', 'HEAD');
  // The trusted clone's view of GitHub: its remote, with a credential no job may read, and main.
  git('remote', 'add', 'origin', 'https://x-access-token:secret@github.com/werk-flow/werkflow-app');
  git('update-ref', 'refs/remotes/origin/main', commit);
  mkdirSync(join(folder, 'bin'));
  writeFileSync(
    join(folder, 'bin/supabase'),
    `#!/usr/bin/env bash\necho "supabase $*" >> "${folder}/supabase.calls"\n`,
  );
  chmodSync(join(folder, 'bin/supabase'), 0o755);
  // sudo as the job user: records its arguments, then runs the command with its environment and the
  // job user's home.
  writeFileSync(
    join(folder, 'bin/sudo'),
    `#!/usr/bin/env bash\necho "$*" >> "${folder}/sudo.calls"\nenv | sort >> "${folder}/sudo.env"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexport HOME="${folder}/job-home"\nexec "$@"\n`,
  );
  chmodSync(join(folder, 'bin/sudo'), 0o755);
  mkdirSync(join(folder, 'job-home'));
  process.env.PATH = `${join(folder, 'bin')}:${saved.PATH}`;
  process.env.RECORD_DIR = folder;
  // The trusted sibling step gets only PATH and HOME: its stub records into HOME.
  process.env.HOME = folder;
  // The orchestrator's own variables, which no job may inherit.
  process.env.CI_LEDGER = '/ledger.jsonl';
  process.env.CI_PUBLISHER = '/publish';
  process.env.GH_TOKEN = 'orchestrator-token';
  process.env.QUEUE_STATE = '/work/queue-state.json';
});

afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
  rmSync(folder, { recursive: true, force: true });
});

const recorded = (file: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(join(folder, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );

const executor = () =>
  processExecutor({
    source,
    root: join(folder, 'work'),
    trusted: join(folder, 'trusted'),
    commit,
    machineStart: true,
    replaceStack: false,
    stackLock: join(folder, 'stack.lock'),
    jobUser: 'nobody',
    sudo: join(folder, 'bin/sudo'),
    log: () => undefined,
  });

const task = (
  job: ExecutorTask['unit']['job'],
  env: Record<string, string> = {},
  timeoutMs = 60_000,
): ExecutorTask => ({
  unit: { job, shard: null },
  env: { CI_EVENT: 'pr', CI_RUN_ATTEMPT: '1', ...env },
  prepareEnv: job === 'fast' ? { SIBLING_REPOSITORIES_TOKEN: 'sibling-token' } : {},
  timeoutMs,
});

test("a job's body sees only its task's variables and what its environment steps passed on", async () => {
  const run = await executor().run(task('fast', { GH_TOKEN: 'job-token' }), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  // Only the trusted copy's sibling step holds the token; the tested commit's steps (its install
  // scripts included) and its body never do. That step runs outside the tested checkout, so its Bun
  // configuration never preloads code into the process that holds the token.
  const siblings = recorded('prepare-siblings.env');
  const clone = join(folder, 'work/fast/werkflow-app');
  expect(siblings.SIBLING_REPOSITORIES_TOKEN).toBe('sibling-token');
  expect(siblings.CWD).toBe(join(folder, 'trusted'));
  expect(siblings.CI_CHECKOUT).toBe(clone);
  expect(readFileSync(join(folder, 'job-home/preload.log'), 'utf8').split('\n').filter(Boolean)).toEqual([
    'none',
    'none',
  ]);
  expect(existsSync(join(folder, 'preload.log'))).toBe(false);
  const prepare = recorded('job-home/prepare-fast.env');
  const body = recorded('job-home/job-fast.env');
  expect(prepare.SIBLING_REPOSITORIES_TOKEN).toBeUndefined();
  expect(body.SIBLING_REPOSITORIES_TOKEN).toBeUndefined();
  expect(body.GITHUB_ENV).toBeUndefined();
  for (const seen of [prepare, body]) {
    // The job user's home, and nothing of the orchestrator's environment but the allowed host variables.
    expect(seen.HOME).toBe(join(folder, 'job-home'));
    expect(seen.QUEUE_STATE).toBeUndefined();
    expect(seen.CI_LEDGER).toBeUndefined();
    expect(seen.CI_PUBLISHER).toBeUndefined();
    expect(seen.GH_TOKEN).toBe('job-token');
    expect(seen.CI_MACHINE_START).toBe('true');
    expect(Number.isNaN(Date.parse(seen.CI_JOB_STARTED_AT ?? ''))).toBe(false);
  }
  // The body takes what the steps passed on from the file, through job.ts: never through the
  // launcher's environment.
  expect(body.SHRINK_ONLY_GROWTH_APPROVED).toBe('true');
  expect(body.CI_PASSED_ENV).toBe(join(folder, 'work/fast/fast.env'));
  expect(readFileSync(join(folder, 'sudo.env'), 'utf8')).not.toContain('SHRINK_ONLY_GROWTH_APPROVED');
  // The job ran in its own clone of the commit, whose origin is GitHub without the credential and
  // whose origin/main is the trusted clone's.
  const cloneGit = (...args: string[]) => execFileSync('git', args, { cwd: clone, encoding: 'utf8' }).trim();
  expect(cloneGit('rev-parse', 'HEAD')).toBe(commit);
  expect(cloneGit('rev-parse', 'origin/main')).toBe(commit);
  expect(cloneGit('remote', 'get-url', 'origin')).toBe('https://github.com/werk-flow/werkflow-app');
});

// The queue starts run-commit as its own user; a job must reach neither the queue's state, its
// publisher hook nor its tokens, so every command of the tested commit runs as the job user.
test("every command of the job runs as the job user, with its variables' values outside the arguments", async () => {
  const run = await executor().run(task('fast', { GH_TOKEN: 'job-token' }), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  const calls = readFileSync(join(folder, 'sudo.calls'), 'utf8').trim().split('\n');
  const commands = calls.map((call) => call.replace(/ --preserve-env=\S+/, '').replace(/PATH=\S+ /, ''));
  expect(commands.map((call) => call.split(' -- ')[0])).toEqual(calls.map(() => '-n -H -u nobody'));
  expect(commands.map((call) => call.split(' -- ')[1]?.split(' ').slice(1, 3).join(' '))).toEqual([
    'git clone',
    'git fetch',
    'git remote',
    'git checkout',
    `${process.execPath} scripts/ci/prepare.ts`,
    `${process.execPath} scripts/ci/job.ts`,
  ]);
  // The trusted sibling step, which holds the sibling token, runs as the orchestrator.
  expect(calls.some((call) => call.includes('siblings'))).toBe(false);
  for (const secret of ['job-token', 'sibling-token', 'orchestrator-token'])
    expect(calls.some((call) => call.includes(secret))).toBe(false);
});

test("an executor refuses a job user that is the orchestrator's own user, root or no user", () => {
  // By the user id, whatever $USER says.
  process.env.USER = 'someone-else';
  const own = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim();
  for (const [jobUser, cause] of [
    [own, 'is the user run-commit runs as'],
    ['root', 'is the user run-commit runs as'],
    ['', 'CI_JOB_USER names the user'],
    ['no-such-ci-user', 'is no user of this host'],
  ] as const)
    expect(() =>
      processExecutor({
        source,
        root: join(folder, 'work'),
        commit,
        machineStart: true,
        replaceStack: false,
        stackLock: join(folder, 'stack.lock'),
        jobUser,
        sudo: join(folder, 'bin/sudo'),
        trusted: join(folder, 'trusted'),
        log: () => undefined,
      }),
    ).toThrow(cause);
});

test('a job past its timeout is ended and gives no exit code', async () => {
  const run = await executor().run(task('sql', { HANG: '1' }, 2_000), new AbortController().signal);
  expect(run.exitCode, run.detail).toBeNull();
  expect(run.detail).toContain('its timeout');
});

test("only a stack the job started is stopped, and the host's stack lock passes on", async () => {
  await executor().run(task('sql'), new AbortController().signal);
  expect(existsSync(join(folder, 'supabase.calls'))).toBe(false);
  await executor().run(task('browser', { STARTS_STACK: '1', CI_SHARD: '1' }), new AbortController().signal);
  expect(readFileSync(join(folder, 'supabase.calls'), 'utf8')).toBe('supabase stop --no-backup\n');
  expect(existsSync(join(folder, 'stack.lock'))).toBe(false);
  expect(recorded('job-home/job-browser.env').CI_STACK_STARTED).toBeUndefined();
});

test('a stack lock whose holder died is taken over, and the job runs', async () => {
  // A process id no live process holds: the newest one, released.
  const dead = execFileSync('bash', ['-c', 'true & echo $!'], { encoding: 'utf8' }).trim();
  writeFileSync(join(folder, 'stack.lock'), dead);
  const run = await executor().run(task('sql'), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  expect(existsSync(join(folder, 'stack.lock'))).toBe(false);
  expect(existsSync(join(folder, 'stack.lock.takeover'))).toBe(false);
});

// A job's steps write GITHUB_ENV; a PATH there must not choose the sudo the orchestrator runs, nor
// reach the launcher's environment at all.
test("a PATH a job's steps pass on never chooses the sudo that launches its body", async () => {
  const planted = join(folder, 'planted');
  mkdirSync(planted);
  writeFileSync(join(planted, 'sudo'), `#!/usr/bin/env bash\ntouch "${folder}/planted-sudo-ran"\nexit 0\n`);
  chmodSync(join(planted, 'sudo'), 0o755);
  const run = await executor().run(task('fast', { PASS_PATH: planted }), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  expect(existsSync(join(folder, 'planted-sudo-ran'))).toBe(false);
  expect(readFileSync(join(folder, 'sudo.env'), 'utf8').split('\n')).not.toContain(`PATH=${planted}`);
  // The body still ran, as the job user, with the PATH its steps passed on.
  expect(recorded('job-home/job-fast.env').CWD).toBe(join(folder, 'work/fast/werkflow-app'));
});

test('an executor refuses a sudo that is no absolute path of a root-owned file no one else may write', () => {
  expect(launcherProblem('sudo')).toBe('CI_SUDO sudo is no absolute path.');
  expect(launcherProblem(join(folder, 'bin/sudo'))).toContain('is not owned by root');
  expect(launcherProblem(join(folder, 'missing'))).toContain('cannot be read');
  // A root-owned file in root-owned folders, writable by root alone: the host's own sudo passes.
  expect(launcherProblem('/bin/sh')).toBeUndefined();
});

// The sibling step holds a token and runs as the orchestrator: from a folder no job can write, and
// with Bun told to read no configuration or .env file there.
test('the sibling step runs from a folder only the orchestrator writes, and Bun reads no local configuration there', async () => {
  const trusted = join(folder, 'trusted');
  mkdirSync(trusted, { mode: 0o777 });
  chmodSync(trusted, 0o777);
  writeFileSync(join(trusted, 'bunfig.toml'), 'preload = ["./planted.ts"]\n');
  writeFileSync(
    join(trusted, 'planted.ts'),
    `require('node:fs').writeFileSync(${JSON.stringify(join(folder, 'planted-preload-ran'))}, '');\n`,
  );
  writeFileSync(join(trusted, '.env'), 'CI_PLANTED=1\n');
  const run = await executor().run(task('fast'), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  expect(existsSync(join(folder, 'planted-preload-ran'))).toBe(false);
  expect(recorded('prepare-siblings.env').CI_PLANTED).toBeUndefined();
  expect(statSync(trusted).mode & 0o077).toBe(0);
});

test("a task learns of its body's launch after its steps, and a launch that cannot be recorded runs no body", async () => {
  const seen: string[] = [];
  const launched = await executor().run(
    {
      ...task('fast'),
      onLaunch: () => {
        seen.push(`prepare:${existsSync(join(folder, 'job-home/prepare-fast.env'))}`);
        seen.push(`body:${existsSync(join(folder, 'job-home/job-fast.env'))}`);
      },
    },
    new AbortController().signal,
  );
  expect(launched.exitCode, launched.detail).toBe(0);
  expect(seen).toEqual(['prepare:true', 'body:false']);
  rmSync(join(folder, 'job-home/job-fast.env'));
  const refused = await executor().run(
    {
      ...task('sql'),
      onLaunch: () => {
        throw new Error('the work root is read-only');
      },
    },
    new AbortController().signal,
  );
  expect(refused.exitCode, refused.detail).toBeNull();
  expect(refused.detail).toContain('its launch could not be recorded: the work root is read-only');
  expect(existsSync(join(folder, 'job-home/job-sql.env'))).toBe(false);
});
