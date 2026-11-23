// The container executor (scripts/ci/container-executor.ts) against a fake slot: a job's result is
// kept only when it is the run's own, its container never sees the runner's token, and a stop ends
// the container through docker's stop. No Docker, no network, no sleep.
import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  businessProblems,
  clearSlot,
  containerExecutors,
  type SlotShell,
  stageInputs,
} from '../../../scripts/ci/container-executor';
import type { SlotConfig } from './container-slot';
import type { CiResult } from './results';
import type { ExecutorTask } from './run-commit';

const root = mkdtempSync(join(tmpdir(), 'container-executor-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const source = join(root, 'source');
mkdirSync(source);
const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
git('init', '--quiet');
writeFileSync(join(source, 'file'), 'x');
git('add', 'file');
git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'c');
const COMMIT = git('rev-parse', 'HEAD');
const TREE = git('rev-parse', 'HEAD^{tree}');
const RUN_URL = 'https://ci.test/run/1';
const RUN_KEY = '0123456789abcdef-1';
const TOKEN = `ghp_${'y'.repeat(36)}`;

const SLOT: SlotConfig = {
  prefix: [],
  dockerHost: null,
  socket: '/var/run/docker.sock',
  root: '/slot',
  image: 'werkflow-ci:test',
  containerUser: 'image',
};

const planResult = (runUrl: string): CiResult => ({
  version: 1,
  job: 'plan',
  shard: null,
  event: 'pr',
  tree: TREE,
  commit: COMMIT,
  base: null,
  status: 'passed',
  groups: [],
  planReason: '',
  reusedFrom: null,
  listGrowthApproved: false,
  producer: 'machine-runner:pc',
  runUrl,
  startedAt: '2026-11-23T02:00:00.000Z',
  completedAt: '2026-11-23T02:01:00.000Z',
  attempt: 1,
});

/** The slot's files and the commands it saw; `job` decides what the job container does. */
function fakeSlot(
  job: (workspace: string, files: Map<string, string>, stopped: Promise<void>) => Promise<number | null>,
) {
  const files = new Map<string, string>();
  const commands: string[][] = [];
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((done) => (stop = done));
  const shell: SlotShell = async (argv) => {
    commands.push([...argv]);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (argv.includes('werkflow-ci-job')) {
      const workspace = argv[argv.indexOf('--workdir') + 1]?.replace(/\/werkflow-app$/, '') ?? '';
      return { code: await job(workspace, files, stopped), stdout: '', stderr: '' };
    }
    if (argv.includes('stop')) {
      stop();
      return ok();
    }
    if (argv[0] === 'test') return files.has(argv[2] ?? '') ? ok() : { code: 1, stdout: '', stderr: '' };
    if (argv[0] === 'sh' && argv[3] === 'read') {
      const text = files.get(argv[4] ?? '');
      return text === undefined ? { code: 1, stdout: '', stderr: '' } : ok(text);
    }
    return ok();
  };
  return { shell, files, commands };
}

function executors(shell: SlotShell) {
  return containerExecutors(
    {
      source,
      commit: COMMIT,
      workRoot: join(root, 'work'),
      runKey: RUN_KEY,
      replaceStack: true,
      log: () => undefined,
    },
    {
      slot: SLOT,
      shell,
      snapshot: async () => ({ approved: false, openMigrations: [] }),
      businessCheck: () => [],
      siblings: () => undefined,
      // The launch poll and the stop's retry return at once: the job's end decides.
      sleep: () => new Promise((done) => setImmediate(done)),
    },
  );
}

function planTask(results: string): ExecutorTask {
  return {
    unit: { job: 'plan', shard: null },
    env: {
      CI_EVENT: 'pr',
      CI_RUN_URL: RUN_URL,
      CI_RUN_ATTEMPT: '1',
      CI_PRODUCER: 'machine-runner:pc',
      CI_RESULTS_DIR: results,
      GITHUB_REPOSITORY: 'werk-flow/werkflow-app',
      GH_TOKEN: TOKEN,
    },
    prepareEnv: {},
    timeoutMs: 60_000,
  };
}

test("Plan's own result from its container is kept in the run's results, and the container never saw the token", async () => {
  const results = join(root, 'results-own');
  mkdirSync(results);
  const slot = fakeSlot(async (workspace, files) => {
    files.set(`${workspace}/launched`, '');
    files.set(`${workspace}/results/plan.json`, JSON.stringify(planResult(RUN_URL)));
    return 0;
  });
  const outcome = await executors(slot.shell).host.run(planTask(results), new AbortController().signal);
  expect(outcome.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(join(results, 'plan.json'), 'utf8')).runUrl).toBe(RUN_URL);
  expect(slot.commands.flat().join(' ')).not.toContain(TOKEN);
});

test("a result of another run is refused and never reaches the run's results", async () => {
  const results = join(root, 'results-foreign');
  mkdirSync(results);
  const slot = fakeSlot(async (workspace, files) => {
    files.set(`${workspace}/launched`, '');
    files.set(`${workspace}/results/plan.json`, JSON.stringify(planResult('https://ci.test/run/other')));
    return 0;
  });
  const outcome = await executors(slot.shell).host.run(planTask(results), new AbortController().signal);
  expect(outcome.exitCode).toBe(1);
  expect(outcome.detail).toContain('its result is refused');
  expect(existsSync(join(results, 'plan.json'))).toBe(false);
});

test("a stopped run stops the job's container through docker's stop, and the job has no exit", async () => {
  const results = join(root, 'results-stopped');
  mkdirSync(results);
  const controller = new AbortController();
  const slot = fakeSlot(async (workspace, files, stopped) => {
    files.set(`${workspace}/launched`, '');
    controller.abort();
    await stopped;
    return 143;
  });
  const outcome = await executors(slot.shell).host.run(planTask(results), controller.signal);
  expect(outcome.exitCode).toBeNull();
  expect(
    slot.commands.some(
      (command) => command.join(' ') === `docker stop --time 60 werkflow-ci-${RUN_KEY}-plan`,
    ),
  ).toBe(true);
});

test("F15: werkflow-business never enters a job's inputs: this side checks it, and the job is told it is unreadable", async () => {
  const folder = join(root, 'stage-fast');
  const task: ExecutorTask = { ...planTask(join(root, 'results-own')), unit: { job: 'fast', shard: null } };
  const options = {
    snapshot: async () => ({ approved: false, openMigrations: [] }),
    siblings: (_task: ExecutorTask, checkout: string) => {
      for (const sibling of ['werkflow-website', 'werkflow-business']) {
        mkdirSync(join(checkout, '..', sibling), { recursive: true });
        writeFileSync(join(checkout, '..', sibling, 'AGENTS.md'), 'private content');
      }
    },
  };
  let checked = '';
  await stageInputs({
    source,
    commit: COMMIT,
    task,
    folder,
    options: { ...options, businessCheck: (checkout) => ((checked = checkout), []) },
  });
  expect(existsSync(join(folder, 'inputs', 'werkflow-business'))).toBe(false);
  expect(existsSync(join(folder, 'inputs', 'werkflow-website', 'AGENTS.md'))).toBe(true);
  expect(readFileSync(join(folder, 'inputs', 'job.env'), 'utf8')).toBe(
    'WERKFLOW_UNREADABLE_SIBLINGS=werkflow-business\n',
  );
  // The trusted check reads the PR's files as data, at the commit under test.
  expect(readFileSync(join(checked, 'file'), 'utf8')).toBe('x');
  await expect(
    stageInputs({
      source,
      commit: COMMIT,
      task,
      folder,
      options: { ...options, businessCheck: () => ['a link into werkflow-business broke'] },
    }),
  ).rejects.toThrow('werkflow-business');
});

test('S19: the slot counts as empty only once every container and volume on its daemon is gone, and a failed list never passes', async () => {
  const containers = new Set(['job', 'supabase_db']);
  const volumes = new Set(['werkflow-ci-bun-x', 'supabase_db_data']);
  const faults = { stuck: false, listFails: false };
  const shell: SlotShell = async (argv) => {
    const line = argv.join(' ');
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (faults.listFails && line.includes('ps')) return { code: 1, stdout: '', stderr: 'daemon down' };
    if (line === 'docker ps --all --quiet') return ok([...containers].join('\n'));
    if (line === 'docker volume ls --quiet') return ok([...volumes].join('\n'));
    if (!faults.stuck)
      for (const name of argv) {
        containers.delete(name);
        volumes.delete(name);
      }
    return ok();
  };
  expect(await clearSlot(shell, SLOT, true)).toBeUndefined();
  expect([containers.size, volumes.size]).toEqual([0, 0]);
  containers.add('stage');
  faults.stuck = true;
  expect(await clearSlot(shell, SLOT, true)).toContain('stage');
  faults.listFails = true;
  expect(await clearSlot(shell, SLOT, false)).toContain('daemon down');
});

test("CR 187: a launch that cannot be recorded at the job's end fails the job and still empties the slot first", async () => {
  const results = join(root, 'results-unrecorded');
  mkdirSync(results);
  const slot = fakeSlot(async (workspace, files) => {
    files.set(`${workspace}/launched`, '');
    return 0;
  });
  const task: ExecutorTask = {
    ...planTask(results),
    onLaunch: () => {
      throw new Error('the start record cannot be written');
    },
  };
  const outcome = await executors(slot.shell).host.run(task, new AbortController().signal);
  expect(outcome.exitCode).toBeNull();
  expect(outcome.detail).toContain('its launch could not be recorded');
  expect(slot.commands.some((command) => command.join(' ') === 'docker ps --all --quiet')).toBe(true);
});

test("S14: a PR's symbolic link reaches the trusted docs check as a file holding its target's name, never the target", async () => {
  const secret = join(root, 'secret.txt');
  writeFileSync(secret, 'TRUSTED-SIDE-SECRET');
  const pr = join(root, 'pr-with-link');
  mkdirSync(pr);
  const run = (...args: string[]) => execFileSync('git', args, { cwd: pr, encoding: 'utf8' }).trim();
  run('init', '--quiet');
  symlinkSync(secret, join(pr, 'link.md'));
  run('add', 'link.md');
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'link');
  const seen: string[] = [];
  await stageInputs({
    source: pr,
    commit: run('rev-parse', 'HEAD'),
    task: { ...planTask(join(root, 'results-own')), unit: { job: 'fast', shard: null } },
    folder: join(root, 'stage-link'),
    options: {
      snapshot: async () => ({ approved: false, openMigrations: [] }),
      siblings: (_task, checkout) => mkdirSync(join(checkout, '..', 'werkflow-website'), { recursive: true }),
      businessCheck: (checkout) => (seen.push(readFileSync(join(checkout, 'link.md'), 'utf8')), []),
    },
  });
  expect(seen).toEqual([secret]);
});

test('S25: the trusted docs check counts only with its report, writes nothing into the checkout, and fails on no report or its deadline', () => {
  const bundles = join(root, 'bundles');
  mkdirSync(bundles, { recursive: true });
  const checkout = join(root, 'docs-checkout');
  mkdirSync(checkout, { recursive: true });
  const bundle = (body: string) => writeFileSync(join(bundles, `check-docs-${COMMIT}.js`), body);
  bundle(
    "require('fs').writeFileSync(process.env.WERKFLOW_DOCS_REPORT, JSON.stringify({ problems: ['werkflow-business/AGENTS.md links nowhere', 'an app problem'] })); process.exit(1);",
  );
  expect(businessProblems(source, bundles, checkout)).toEqual(['werkflow-business/AGENTS.md links nowhere']);
  expect(readdirSync(checkout)).toEqual([]);
  bundle('process.exit(0);');
  expect(() => businessProblems(source, bundles, checkout)).toThrow('gave no report');
  bundle('setInterval(() => undefined, 1000);');
  expect(() => businessProblems(source, bundles, checkout, 300)).toThrow('gave no report');
});
