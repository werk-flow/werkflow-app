// The process executor of scripts/ci/run-commit.ts (scripts/ci/process-executor.ts), the local and
// test one, on a throwaway repository whose prepare.ts and job.ts record what they see: each job runs
// in its own clone of the commit, its body never sees the orchestrator's variables or the sibling
// token, the variables its environment steps pass on reach the body, a job ends at its timeout, and
// only a stack the job started is stopped before the host's stack lock passes on.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { processExecutors } from '../../../scripts/ci/process-executor';
import type { ExecutorTask } from './run-commit';

let folder = '';
let source = '';
let commit = '';
const saved = { ...process.env };

// Each stub writes its environment's CI and token variables to <folder>/<script>-<job>.env.
const RECORD = (script: string) => `
import { appendFileSync, writeFileSync } from 'node:fs';
const job = process.argv.at(-1);
const seen = Object.entries(process.env).filter(([name]) => /^(CI_|GH_TOKEN|SIBLING_|SHRINK_|EMAIL_|GITHUB_ENV|HOME$)/.test(name)).sort();
writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/${script}-' + job + '.env', [...seen, ['CWD', process.cwd()]].map(([name, value]) => name + '=' + value).join('\\n'));
writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/${script}-' + job + '.names', Object.keys(process.env).sort().join('\\n'));
`;
const PREPARE = `${RECORD('prepare')}
if (process.env.STARTS_STACK === '1') appendFileSync(process.env.GITHUB_ENV, 'CI_STACK_STARTED=1\\n');
appendFileSync(process.env.GITHUB_ENV, 'SHRINK_ONLY_GROWTH_APPROVED=true\\n');
if (process.env.REMOVE_CHECKOUT === '1' && job !== 'siblings') require('node:fs').rmSync(process.cwd(), { recursive: true });
`;
const JOB = `${RECORD('job')}
if (process.env.HANG === '1') await Bun.sleep(60_000);
// A child in the job's own group that would outlive the job: a test server left running.
if (process.env.LEAVE_CHILD === '1') {
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/child.pid', String(child.pid));
  child.unref();
}
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
  process.env.PATH = `${join(folder, 'bin')}:${saved.PATH}`;
  process.env.RECORD_DIR = folder;
  // The trusted sibling step gets only PATH and HOME: its stub records into HOME.
  process.env.HOME = folder;
  // The orchestrator's own variables, which no job may inherit.
  process.env.CI_LEDGER = '/ledger.jsonl';
  process.env.CI_PUBLISHER = '/publish';
  process.env.GH_TOKEN = 'orchestrator-token';
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

// The run's workspaces are <folder>/run, its trusted folder <folder>/trusted, the stack lock <folder>/stack.lock.
const executor = () =>
  processExecutors({
    source,
    commit,
    workRoot: folder,
    runKey: 'run',
    replaceStack: false,
    log: () => undefined,
  }).jobs;

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
  const clone = join(folder, 'run/fast/werkflow-app');
  expect(siblings.SIBLING_REPOSITORIES_TOKEN).toBe('sibling-token');
  expect(siblings.CWD).toBe(join(folder, 'trusted'));
  expect(siblings.CI_CHECKOUT).toBe(clone);
  expect(readFileSync(join(folder, 'preload.log'), 'utf8').split('\n').filter(Boolean)).toEqual([
    'none',
    'none',
  ]);
  const prepare = recorded('prepare-fast.env');
  const body = recorded('job-fast.env');
  expect(prepare.SIBLING_REPOSITORIES_TOKEN).toBeUndefined();
  expect(body.SIBLING_REPOSITORIES_TOKEN).toBeUndefined();
  expect(body.GITHUB_ENV).toBeUndefined();
  for (const seen of [prepare, body]) {
    // Nothing of the orchestrator's own variables: only the task's.
    expect(seen.CI_LEDGER).toBeUndefined();
    expect(seen.CI_PUBLISHER).toBeUndefined();
    expect(seen.GH_TOKEN).toBe('job-token');
    expect(seen.CI_MACHINE_START).toBe('true');
    expect(Number.isNaN(Date.parse(seen.CI_JOB_STARTED_AT ?? ''))).toBe(false);
  }
  expect(body.SHRINK_ONLY_GROWTH_APPROVED).toBe('true');
  // The job ran in its own clone of the commit, whose origin is GitHub without the credential and
  // whose origin/main is the trusted clone's.
  const cloneGit = (...args: string[]) => execFileSync('git', args, { cwd: clone, encoding: 'utf8' }).trim();
  expect(cloneGit('rev-parse', 'HEAD')).toBe(commit);
  expect(cloneGit('rev-parse', 'origin/main')).toBe(commit);
  expect(cloneGit('remote', 'get-url', 'origin')).toBe('https://github.com/werk-flow/werkflow-app');
});

// A job never inherits this process's environment: credentials outside run-commit's refusal list,
// such as a Supabase access token in the owner's shell, never reach a job's steps or body.
test("a job's steps and body get only the host variables a job needs, never the orchestrator's other variables", async () => {
  const credentials = {
    SUPABASE_ACCESS_TOKEN: 'sbp_secret',
    STRIPE_SECRET_KEY: 'sk_live_secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    VERCEL_TOKEN: 'vercel-secret',
    NPM_TOKEN: 'npm-secret',
    DATABASE_URL: 'postgres://user:secret@db.example/app',
  };
  Object.assign(process.env, credentials, { LANG: 'de_DE.UTF-8', TZ: 'Europe/Berlin' });
  const run = await executor().run(task('fast'), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  for (const file of ['prepare-siblings', 'prepare-fast', 'job-fast']) {
    const names = readFileSync(join(folder, `${file}.names`), 'utf8').split('\n');
    for (const name of Object.keys(credentials)) expect([file, names.includes(name)]).toEqual([file, false]);
    expect([file, names.includes('PATH'), names.includes('HOME')]).toEqual([file, true, true]);
    if (file !== 'prepare-siblings')
      expect([file, names.includes('LANG'), names.includes('TZ')]).toEqual([file, true, true]);
  }
});

// run-commit.ts refuses it for every run that holds what a job must not reach (isolationProblem).
test('the process executor says it isolates no job', () => {
  const executors = processExecutors({
    source,
    commit,
    workRoot: folder,
    runKey: 'run',
    replaceStack: false,
    log: () => undefined,
  });
  expect([executors.host.isolatesJobs, executors.jobs.isolatesJobs]).toEqual([false, false]);
});

test('a job past its timeout is ended and gives no exit code', async () => {
  const run = await executor().run(task('sql', { HANG: '1' }, 2_000), new AbortController().signal);
  expect(run.exitCode, run.detail).toBeNull();
  expect(run.detail).toContain('its timeout');
});

test('a job that exits normally leaves nothing of its process group running', async () => {
  const run = await executor().run(task('sql', { LEAVE_CHILD: '1' }), new AbortController().signal);
  expect(run.exitCode, run.detail).toBe(0);
  const child = Number(readFileSync(join(folder, 'child.pid'), 'utf8'));
  let running = true;
  try {
    process.kill(child, 0);
  } catch {
    running = false;
  }
  if (running) process.kill(child, 'SIGKILL');
  expect(running).toBe(false);
});

test("only a stack the job started is stopped, and the host's stack lock passes on", async () => {
  await executor().run(task('sql'), new AbortController().signal);
  expect(existsSync(join(folder, 'supabase.calls'))).toBe(false);
  await executor().run(task('browser', { STARTS_STACK: '1', CI_SHARD: '1' }), new AbortController().signal);
  expect(readFileSync(join(folder, 'supabase.calls'), 'utf8')).toBe('supabase stop --no-backup\n');
  expect(existsSync(join(folder, 'stack.lock'))).toBe(false);
  expect(recorded('job-browser.env').CI_STACK_STARTED).toBeUndefined();
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

// The sibling step holds a token: it runs from a folder no job writes, and Bun reads no configuration
// or .env file there.
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

test('the sibling step refuses a trusted folder that is a link', async () => {
  const elsewhere = join(folder, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(folder, 'trusted'));
  const run = await executor().run(task('fast'), new AbortController().signal);
  expect(run.exitCode, run.detail).toBeNull();
  expect(run.detail).toContain("is not run-commit's own folder");
  expect(existsSync(join(folder, 'prepare-siblings.env'))).toBe(false);
});

test("a task learns of its body's launch after its steps, and a launch that cannot be recorded ends the body", async () => {
  const seen: string[] = [];
  const launched = await executor().run(
    {
      ...task('fast'),
      onLaunch: () => {
        seen.push(`prepare:${existsSync(join(folder, 'prepare-fast.env'))}`);
        seen.push(`body:${existsSync(join(folder, 'job-fast.env'))}`);
      },
    },
    new AbortController().signal,
  );
  expect(launched.exitCode, launched.detail).toBe(0);
  expect(seen).toEqual(['prepare:true', 'body:false']);
  rmSync(join(folder, 'job-fast.env'));
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
  expect(existsSync(join(folder, 'job-sql.env'))).toBe(false);
});

// The run's start record is written on onLaunch: a body that never launched must never be recorded
// as launched, or a crash between the record and the launch pays an owed main run without a Plan.
test('a task learns of its launch only once its body runs, never for a body that could not launch', async () => {
  let launched = false;
  const run = await executor().run(
    {
      ...task('sql', { REMOVE_CHECKOUT: '1' }),
      onLaunch: () => {
        launched = true;
      },
    },
    new AbortController().signal,
  );
  expect(run.exitCode, run.detail).toBeNull();
  expect(launched).toBe(false);
});
