// The process executor of scripts/ci/run-commit.ts (scripts/ci/process-executor.ts), the local and
// test one, on a throwaway repository whose prepare.ts and job.ts record what they see: each job runs
// in its own clone of the commit, its body never sees the orchestrator's variables or the sibling
// token, the variables its environment steps pass on reach the body, a job ends at its timeout, and
// only a stack the job started is stopped before the host's stack lock passes on.
import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { processExecutors } from '../../../scripts/ci/process-executor';
import { assertAppPortFree, workspacePorts } from '../runner/app-port';
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
// Prints its pid and its port once it holds it: LISTEN_PORT, or one the system assigns.
const LISTENER = `const server = require('node:net').createServer().listen(Number(process.env.LISTEN_PORT ?? 0), () => console.log(process.pid + ' ' + server.address().port));`;
const JOB = `${RECORD('job')}
const { spawn } = require('node:child_process');
const reported = (child) => new Promise((resolveReport) => child.stdout.once('data', (chunk) => resolveReport(chunk.toString().trim())));
// A listener in the job's own group that would outlive the job: a test server left running.
if (process.env.LEAVE_CHILD === '1') {
  const child = spawn(process.execPath, ['-e', ${JSON.stringify(LISTENER)}], { stdio: ['ignore', 'pipe', 'ignore'] });
  writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/child', await reported(child));
  child.unref();
}
// The checkout's app port, which browser() serves.
const appPort = require(${JSON.stringify(join(import.meta.dir, '../runner/app-port.ts'))}).workspacePorts(process.cwd()).app;
// A fake test server as browser() starts it on the app port: its own group, whose real test session
// runs the listener in a group of its own, and guardTestServer stops it on SIGTERM.
if (process.env.SERVE === 'guarded') {
  const stops = require(${JSON.stringify(join(import.meta.dir, 'test-server-stop.ts'))});
  const session = ${JSON.stringify(join(import.meta.dir, '../local-stack/test-session.ts'))};
  const source = 'const { runSessionCommand, withTestSession } = require(' + JSON.stringify(session) + '); await withTestSession((signal) => runSessionCommand([process.execPath, "-e", ' + JSON.stringify(${JSON.stringify(LISTENER)}) + '], { signal }));';
  const server = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'ignore'], detached: true, env: { ...process.env, LISTEN_PORT: String(appPort) } });
  const [listener, port] = (await reported(server)).split(' ').map(Number);
  stops.guardTestServer(server.pid, port);
  writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/server', [server.pid, listener, port].join(' '));
}
// A listener on the app port in a group of its own that outlives the job: a test server whose
// controller died before it could stop it.
if (process.env.ORPHAN === '1') {
  const orphan = spawn(process.execPath, ['-e', ${JSON.stringify(LISTENER)}], { stdio: ['ignore', 'pipe', 'ignore'], detached: true, env: { ...process.env, LISTEN_PORT: String(appPort) } });
  writeFileSync((process.env.RECORD_DIR ?? process.env.HOME) + '/orphan', await reported(orphan));
  orphan.unref();
}
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
  process.env.PATH = `${join(folder, 'bin')}:${saved.PATH}`;
  process.env.RECORD_DIR = folder;
  // The trusted sibling step gets only PATH and HOME: its stub records into HOME.
  process.env.HOME = folder;
  // The orchestrator's own variables, which no job may inherit.
  process.env.CI_LEDGER = '/ledger.jsonl';
  process.env.CI_PUBLISHER = '/publish';
  process.env.GH_TOKEN = 'orchestrator-token';
});

// Process groups a failed test may leave behind.
const leftovers: number[] = [];

function groupListed(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const groupId of leftovers.splice(0)) {
    try {
      process.kill(-groupId, 'SIGKILL');
    } catch {
      // The group already ended.
    }
  }
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
const executors = () =>
  processExecutors({
    source,
    commit,
    workRoot: folder,
    runKey: 'run',
    replaceStack: false,
    log: () => undefined,
  });

/**
 * A job's checkout as a linked worktree of the source, made before the job runs: the executor keeps
 * it, and its app port is one of the worktree ports derived from its path (workspacePorts), never
 * the main checkout's 3000 a clone serves.
 */
function worktreeFor(task: ExecutorTask): string {
  const { job, shard } = task.unit;
  const name = job === 'plan' || job === 'check' ? 'host' : shard === null ? job : `${job}-${shard}`;
  const checkout = join(folder, 'run', name, 'werkflow-app');
  if (!existsSync(checkout))
    execFileSync('git', ['worktree', 'add', '--quiet', '--detach', checkout, commit], { cwd: source });
  return checkout;
}

/** The run's job executor, every job in a worktree checkout. */
const executor = () => {
  const { jobs } = executors();
  return {
    run: (given: ExecutorTask, signal: AbortSignal) => {
      worktreeFor(given);
      return jobs.run(given, signal);
    },
  };
};

/** The app port of a job's worktree checkout, proven free before the job runs. */
async function appPortOf(task: ExecutorTask): Promise<number> {
  const port = workspacePorts(worktreeFor(task)).app;
  await assertAppPortFree(port);
  return port;
}

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
  // The one job that clones: it proves the clone's origin and commit.
  const run = await executors().jobs.run(
    task('fast', { GH_TOKEN: 'job-token' }),
    new AbortController().signal,
  );
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

test('a job that exits normally leaves nothing of its process group holding a port', async () => {
  const run = await executor().run(task('sql', { LEAVE_CHILD: '1' }), new AbortController().signal);
  const [child, port] = readFileSync(join(folder, 'child'), 'utf8').split(' ').map(Number);
  if (child === undefined || port === undefined) throw new Error('The job reported no listener.');
  leftovers.push(child);
  expect(run.exitCode, run.detail).toBe(0);
  await expect(assertAppPortFree(port)).resolves.toBeUndefined();
});

test('a cancelled job stops its own test server before it exits, and its app port is proven free', async () => {
  const browser = task('browser', { SERVE: 'guarded', HANG: '1' });
  const appPort = await appPortOf(browser);
  const controller = new AbortController();
  const watcher = watch(folder, (_event, name) => {
    if (name === 'server') controller.abort();
  });
  try {
    const run = await executor().run(browser, controller.signal);
    const [server, listener, port] = readFileSync(join(folder, 'server'), 'utf8').split(' ').map(Number);
    if (server === undefined || listener === undefined || port === undefined)
      throw new Error('The job reported no test server.');
    leftovers.push(server, listener);
    expect(port).toBe(appPort);
    expect(run.exitCode, run.detail).toBeNull();
    expect(run.detail).not.toContain('cleanup could not be verified');
    expect([groupListed(server), groupListed(listener)]).toEqual([false, false]);
    await expect(assertAppPortFree(port)).resolves.toBeUndefined();
  } finally {
    watcher.close();
  }
});

test('a browser job that leaves its app port held fails, even with exit 0, and no further job of the run starts on the host', async () => {
  const browser = task('browser', { ORPHAN: '1' });
  const appPort = await appPortOf(browser);
  const { jobs, host } = executors();
  const run = await jobs.run(browser, new AbortController().signal);
  const [orphan, port] = readFileSync(join(folder, 'orphan'), 'utf8').split(' ').map(Number);
  if (orphan === undefined || port === undefined) throw new Error('The job reported no listener.');
  leftovers.push(orphan);
  expect(port).toBe(appPort);
  expect(recorded('job-browser.env').CWD).toBe(join(folder, 'run/browser/werkflow-app'));
  expect(run.exitCode, run.detail).toBeNull();
  expect(run.detail).toContain(`cleanup could not be verified: port ${appPort} is still held`);
  // The executor signals no group it did not start: the listener is still there.
  expect(groupListed(orphan)).toBe(true);
  // Nothing of the next jobs runs: not their steps, not their bodies, Check neither.
  const components = task('components');
  worktreeFor(components);
  const next = await jobs.run(components, new AbortController().signal);
  const check = await host.run(task('check'), new AbortController().signal);
  for (const refused of [next, check]) {
    expect(refused.exitCode, refused.detail).toBeNull();
    expect(refused.detail).toBe(`not started: cleanup could not be verified: port ${appPort} is still held`);
  }
  expect(existsSync(join(folder, 'prepare-components.env'))).toBe(false);
  expect(existsSync(join(folder, 'prepare-check.env'))).toBe(false);
});

// Only the browser job serves the app port: another job's lock is never refused for a listener there,
// such as a developer's own server or Fast's build that binds it a moment.
test('a job that serves no test server is never refused for a listener on its app port', async () => {
  const sql = task('sql', { ORPHAN: '1' });
  await appPortOf(sql);
  const { jobs } = executors();
  const run = await jobs.run(sql, new AbortController().signal);
  const [orphan] = readFileSync(join(folder, 'orphan'), 'utf8').split(' ').map(Number);
  if (orphan !== undefined) leftovers.push(orphan);
  expect(run.exitCode, run.detail).toBe(0);
  expect(existsSync(join(folder, 'stack.lock'))).toBe(false);
});

/** Browser shard `shard`, whose workspace and checkout are its own. */
const shard = (shardNumber: number, env: Record<string, string>): ExecutorTask => ({
  ...task('browser', { ...env, CI_SHARD: String(shardNumber) }),
  unit: { job: 'browser', shard: shardNumber },
});

test('a job waiting for the stack lock ends unstarted once the holder leaves its app port held, and the run ends', async () => {
  const first = shard(1, { ORPHAN: '1' });
  const second = shard(2, {});
  const appPort = await appPortOf(first);
  await appPortOf(second);
  const jobs = executor();
  // The first takes the lock at once; the second waits for it while the first runs.
  const [run, waited] = await Promise.all([
    jobs.run(first, new AbortController().signal),
    jobs.run(second, new AbortController().signal),
  ]);
  const [orphan] = readFileSync(join(folder, 'orphan'), 'utf8').split(' ').map(Number);
  if (orphan !== undefined) leftovers.push(orphan);
  expect(run.exitCode, run.detail).toBeNull();
  expect(run.detail).toContain(`cleanup could not be verified: port ${appPort} is still held`);
  expect(waited.exitCode, waited.detail).toBeNull();
  expect(waited.detail).toBe(`not started: cleanup could not be verified: port ${appPort} is still held`);
  expect(existsSync(join(folder, 'prepare-browser.env'))).toBe(true);
  expect(recorded('prepare-browser.env').CI_SHARD).toBe('1');
});

test('a stack whose stop fails keeps the lock and refuses every further start on the host', async () => {
  // The stub stop records its process, whose group then refuses the executor's signal.
  writeFileSync(join(folder, 'bin/supabase'), `#!/usr/bin/env bash\necho $$ > "${folder}/supabase.pid"\n`);
  const stopped = join(folder, 'supabase.pid');
  const kill = process.kill.bind(process);
  const refuse = spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (
      pid < 0 &&
      signal === 'SIGKILL' &&
      existsSync(stopped) &&
      -pid === Number(readFileSync(stopped, 'utf8'))
    )
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    return kill(pid, signal);
  });
  try {
    const jobs = executor();
    const run = await jobs.run(task('sql', { STARTS_STACK: '1' }), new AbortController().signal);
    expect(run.exitCode, run.detail).toBeNull();
    expect(run.detail).toContain("cleanup could not be verified: the stack's stop failed after it ended");
    expect(existsSync(join(folder, 'stack.lock'))).toBe(true);
    const next = await jobs.run(shard(1, {}), new AbortController().signal);
    expect(next.exitCode, next.detail).toBeNull();
    expect(next.detail).toBe("not started: cleanup could not be verified: the stack's stop failed");
    expect(existsSync(join(folder, 'prepare-browser.env'))).toBe(false);
  } finally {
    refuse.mockRestore();
  }
});

test('a process group the executor may not signal fails its job with the reason, never the executor', async () => {
  const kill = process.kill.bind(process);
  const refuse = spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (pid < 0 && signal === 'SIGKILL') throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    return kill(pid, signal);
  });
  try {
    const run = await executor().run(task('sql'), new AbortController().signal);
    expect(run.exitCode, run.detail).toBeNull();
    expect(run.detail).toContain('could not be signalled: kill EPERM');
  } finally {
    refuse.mockRestore();
  }
});

test('a cleanup error after a command closed fails its job, and the command never stays pending', async () => {
  // Once the body runs, its group reads as listed after SIGKILL, and its log cannot take the warning.
  // Each such read moves the clock past groupGone's wait, so the wait ends at its next check.
  let launched = false;
  let clock = new Date('2026-03-02T08:00:00Z').getTime();
  const kill = process.kill.bind(process);
  const listed = spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
    if (!launched || pid >= 0 || signal !== 0) return kill(pid, signal);
    clock += 10_000;
    setSystemTime(new Date(clock));
    return true;
  });
  let escape = (): void => undefined;
  const escaped = new Promise<'escaped'>((resolveEscape) => {
    escape = () => resolveEscape('escaped');
  });
  process.once('unhandledRejection', escape);
  try {
    const run = executor().run(
      {
        ...task('sql'),
        onLaunch: () => {
          const log = join(folder, 'run/sql/sql.log');
          rmSync(log);
          mkdirSync(log);
          setSystemTime(new Date(clock));
          launched = true;
        },
      },
      new AbortController().signal,
    );
    const outcome = await Promise.race([run, escaped]);
    if (outcome === 'escaped') throw new Error('The cleanup error escaped, and the command stays pending.');
    expect(outcome.exitCode, outcome.detail).toBeNull();
    expect(outcome.detail).toContain('the executor failed: EISDIR');
  } finally {
    process.removeListener('unhandledRejection', escape);
    listed.mockRestore();
    setSystemTime();
  }
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
