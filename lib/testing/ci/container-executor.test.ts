// The container executor (scripts/ci/container-executor.ts) against a fake slot: a job's result is
// kept only when it is the run's own, its container never sees the runner's token, and a stop ends
// the container through docker's stop. No Docker, no network, no sleep.
import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearRun,
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
      generation: 7,
      snapshot: async () => ({ labels: {}, openMigrations: [] }),
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
  expect(slot.commands.find((command) => command.includes('werkflow-ci-job'))).toContain(
    'org.werkflow.ci-generation=7',
  );
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
    snapshot: async () => ({ labels: {}, openMigrations: [] }),
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

test('F4: a stopped run counts as clean only once its job and staging containers and every Supabase stack are gone', async () => {
  const containers = new Set([`werkflow-ci-${RUN_KEY}-fast`, `werkflow-ci-${RUN_KEY}-stage`]);
  const stacks = new Set(['supabase_db']);
  let stuck = false;
  const shell: SlotShell = async (argv) => {
    const line = argv.join(' ');
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (line.includes(`label=org.werkflow.ci-run=${RUN_KEY}`)) return ok([...containers].join('\n'));
    if (line.includes('label=com.supabase.cli.project')) return ok([...stacks].join('\n'));
    if (argv.includes('rm') && !stuck) {
      for (const name of argv) containers.delete(name);
      stacks.clear();
    }
    return ok();
  };
  expect(await clearRun(shell, SLOT, RUN_KEY)).toBeUndefined();
  containers.add(`werkflow-ci-${RUN_KEY}-stage`);
  stuck = true;
  expect(await clearRun(shell, SLOT, RUN_KEY)).toContain(`werkflow-ci-${RUN_KEY}-stage`);
});
