// The runner rules scripts/ci/run-commit.ts enforces before anything runs: the process executor for
// local and test runs only, one orchestrator per run, a rerun that counts its attempt up, at most one
// `main` run per commit, no Check for a queue run, and a scheduler that never names a run its
// run-commit holds (scripts/ci/schedule.ts). The queue's hooks run through a stub isolating executor.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCommitCommand } from '../../../scripts/ci/run-commit';
import { processExecutors } from '../../../scripts/ci/process-executor';
import { pull } from '../fixtures/merge-queue-world';
import { integrationEnvironment } from './queue';
import { mainEnvironment } from './queue-main-run';
import { type CiResult, readResult } from './results';
import {
  acknowledgedStart,
  acknowledgeStart,
  claimMainRun,
  type Executor,
  type Executors,
  type ExecutorSetup,
  type ExecutorTask,
  mainStartRecord,
  releaseMainRun,
  RUN_COMMIT_LOCK,
  runVariables,
} from './run-commit';

const repository = resolve(import.meta.dir, '../../..');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
let folder = '';
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'run-commit-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function runCommit(env: Record<string, string>): { status: number | null; stderr: string } {
  const ran = spawnSync(process.execPath, [join(repository, 'scripts/ci/run-commit.ts')], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      HOME: folder,
      CI_EVENT: 'pr',
      CI_RESULTS_DIR: join(folder, 'results'),
      CI_RUN_URL: 'https://ci.example/runs/2',
      CI_COMMIT: head,
      CI_WORK_ROOT: join(folder, 'work'),
      ...env,
    },
  });
  return { status: ran.status, stderr: ran.stderr };
}

const receipt = (overrides: Partial<CiResult>): CiResult => ({
  version: 1,
  job: 'plan',
  shard: null,
  event: 'main',
  tree: 'a'.repeat(40),
  commit: head,
  base: null,
  status: 'passed',
  groups: [],
  planReason: 'Selection by diff',
  reusedFrom: null,
  listGrowthApproved: false,
  producer: 'mac-standin',
  runUrl: 'https://ci.example/runs/1',
  startedAt: '2026-11-21T08:00:00.000Z',
  completedAt: '2026-11-21T08:01:00.000Z',
  attempt: 1,
  ...overrides,
});

test('a run refuses before it runs anything, with exit 2, on each broken precondition', () => {
  const results = join(folder, 'results');
  const ledger = join(folder, 'ledger.jsonl');
  writeFileSync(ledger, `${JSON.stringify(receipt({}))}\n`);
  for (const [env, cause, prepare] of [
    [{ CI_WORK_ROOT: '' }, 'CI_WORK_ROOT are required', undefined],
    // A failure no check names, such as a results directory that is a file, is a refusal too.
    [{}, 'the run could not start', () => (rmSync(results, { recursive: true }), writeFileSync(results, ''))],
    [{ CI_COMMIT: 'main' }, 'is no full commit id', undefined],
    [{ CI_RUN_ATTEMPT: '0' }, 'is no attempt number', undefined],
    [{ CI_QUEUE_COMMIT: head, CI_PUBLISHER: '/bin/true' }, 'A queue run posts no Check', undefined],
    [{ CI_EXECUTOR: 'mirror' }, 'CI_EXECUTOR=mirror needs CI_MIRROR_REPO and CI_MIRROR_TOKEN', undefined],
    [{ CI_EXECUTOR: 'docker' }, 'CI_EXECUTOR docker is no executor', undefined],
    [{}, 'another run-commit holds this run', () => writeFileSync(join(results, RUN_COMMIT_LOCK), '')],
    [
      { CI_RUN_ATTEMPT: '2' },
      'holds attempt 2; a rerun counts CI_RUN_ATTEMPT up',
      () => writeFileSync(join(results, 'plan.json'), JSON.stringify(receipt({ event: 'pr', attempt: 2 }))),
    ],
    [{}, 'holds results without a readable Plan', () => writeFileSync(join(results, 'fast.json'), '{')],
  ] as const) {
    rmSync(results, { recursive: true, force: true });
    mkdirSync(results, { recursive: true });
    prepare?.();
    const refused = runCommit(env);
    expect([cause, refused.status]).toEqual([cause, 2]);
    expect(refused.stderr).toContain(cause);
    // A refusal starts no workspace, claims no main commit and records no start.
    expect([cause, readdirSync(folder).includes('work')]).toEqual([cause, false]);
  }
  expect(readdirSync(results)).toEqual(['fast.json']);
});

// The process executor runs every job as this user: a job would reach the ledger, the queue's state
// and hooks, the publisher and every credential this process holds.
test('the process executor refuses a run with a ledger, from the queue, with the publisher or with any credential', () => {
  for (const [name, value] of [
    ['CI_LEDGER', join(folder, 'ledger.jsonl')],
    ['CI_QUEUE_COMMIT', head],
    ['CI_QUEUE_MAIN_RUN', '1'],
    ['CI_PUBLISHER', '/bin/true'],
    ['GH_TOKEN', 'token'],
    ['GITHUB_TOKEN', 'token'],
    ['CI_JOB_GH_TOKEN', 'token'],
    ['SIBLING_REPOSITORIES_TOKEN', 'token'],
    ['CI_MIRROR_TOKEN', 'token'],
  ] as const) {
    const refused = runCommit({ CI_EVENT: 'main', [name]: value });
    expect([name, refused.status]).toEqual([name, 2]);
    expect(refused.stderr).toContain('The process executor runs every job as this user on this host');
    expect(refused.stderr).toContain(`without ${name} (`);
    expect(refused.stderr).toContain('a container per job on the Mac, or a CI mirror job on GitHub');
    expect([name, existsSync(join(folder, 'work'))]).toEqual([name, false]);
    expect([name, existsSync(join(folder, 'results'))]).toEqual([name, false]);
  }
});

// Exit 3 tells the queue that another run pays its owed main run, so it needs that run's durable
// start: a claim whose run has not started yet, or died before it, is a refusal, and the debt stays.
// The one start record of the commit decides both, for this run and for the queue.
test("a second main run of a commit exits 3 only once the claiming run's start is recorded", () => {
  const work = join(folder, 'work');
  claimMainRun(join(work, 'main-runs'), head, 'https://ci.example/runs/1');
  const unstarted = runCommit({ CI_EVENT: 'main' });
  expect(unstarted.status).toBe(2);
  expect(unstarted.stderr).toContain('https://ci.example/runs/1 claimed it but has not started');
  expect(acknowledgedStart(mainStartRecord(work, head), head)).toBeUndefined();
  acknowledgeStart(mainStartRecord(work, head), { commit: head, runUrl: 'https://ci.example/runs/1' });
  const duplicate = runCommit({ CI_EVENT: 'main' });
  expect(duplicate.status).toBe(3);
  expect(acknowledgedStart(mainStartRecord(work, head), head)).toBe('https://ci.example/runs/1');
  expect(readdirSync(join(work, 'main-runs')).sort()).toEqual([head, `${head}.started`]);
});

test('the scheduler never names a held run its run-commit holds; that run starts its own held shards', () => {
  const run = join(folder, 'held');
  mkdirSync(run);
  const plan = receipt({
    event: 'integration',
    plan: {
      jobs: ['plan', 'fast', 'midnight', 'browser', 'check'],
      skips: {},
      shards: [{ shard: 1, groups: 'golden:p1-01' }],
      outputs: { midnight_until: '2026-11-20T23:30:00.000Z' },
    },
  });
  writeFileSync(join(run, 'plan.json'), JSON.stringify(plan));
  const due = (): unknown[] => {
    const answer = spawnSync(
      process.execPath,
      [
        join(repository, 'scripts/ci/schedule.ts'),
        'due',
        '--state',
        join(folder, 'state.json'),
        '--run',
        run,
      ],
      { cwd: repository, encoding: 'utf8' },
    );
    const parsed: unknown = JSON.parse(answer.stdout.trim().split('\n').at(-1) ?? '{}');
    const start = typeof parsed === 'object' && parsed !== null && 'start' in parsed ? parsed.start : [];
    return Array.isArray(start) ? start.filter((entry) => JSON.stringify(entry).includes('"midnight"')) : [];
  };
  expect(due()).toHaveLength(1);
  writeFileSync(join(run, RUN_COMMIT_LOCK), '');
  expect(due()).toEqual([]);
});

test('the first run claims a main commit on this host; the same run claims it again, any other learns the owner', () => {
  const claims = join(folder, 'main-runs');
  expect(claimMainRun(claims, head, 'https://ci.example/runs/1')).toEqual({ claimed: true });
  expect(claimMainRun(claims, head, 'https://ci.example/runs/1')).toEqual({ claimed: true });
  expect(claimMainRun(claims, head, 'https://ci.example/runs/2')).toEqual({
    owner: 'https://ci.example/runs/1',
  });
  writeFileSync(join(folder, 'file'), '');
  expect('unwritable' in claimMainRun(join(folder, 'file'), head, 'https://ci.example/runs/1')).toBe(true);
});

test("a run that never started releases its own claim of a main commit, never another run's", () => {
  const claims = join(folder, 'main-runs');
  expect(claimMainRun(claims, head, 'https://ci.example/runs/1')).toEqual({ claimed: true });
  releaseMainRun(claims, head, 'https://ci.example/runs/2');
  expect(claimMainRun(claims, head, 'https://ci.example/runs/2')).toEqual({
    owner: 'https://ci.example/runs/1',
  });
  // Its queued Check could not be posted, so nothing ran: any run of the commit may start it now.
  releaseMainRun(claims, head, 'https://ci.example/runs/1');
  expect(claimMainRun(claims, head, 'https://ci.example/runs/2')).toEqual({ claimed: true });
  releaseMainRun(join(folder, 'missing'), head, 'https://ci.example/runs/2');
});

test("a job gets the runner's read-only token as its GH_TOKEN, never the runner's own token, ledger or publisher", () => {
  const runner = {
    CI_EVENT: 'integration',
    CI_RUN_URL: 'https://ci.example/runs/2',
    GH_TOKEN: 'queue-merge-token',
    CI_JOB_GH_TOKEN: 'read-only-token',
    CI_LEDGER: '/ledger.jsonl',
    CI_PUBLISHER: '/publish',
    CI_WORK_ROOT: '/work',
  };
  expect(runVariables(runner)).toEqual({
    CI_EVENT: 'integration',
    CI_RUN_URL: 'https://ci.example/runs/2',
    GH_TOKEN: 'read-only-token',
  });
  expect(runVariables({ ...runner, CI_JOB_GH_TOKEN: undefined }).GH_TOKEN).toBeUndefined();
});

test('a start acknowledgement is whole or absent and names its commit', () => {
  const path = join(folder, 'started.json');
  expect(acknowledgedStart(path, head)).toBeUndefined();
  acknowledgeStart(path, { commit: head, runUrl: 'https://ci.example/runs/1' });
  expect(acknowledgedStart(path, head)).toBe('https://ci.example/runs/1');
  expect(acknowledgedStart(path, 'f'.repeat(40))).toBeUndefined();
  writeFileSync(path, '{"commit":');
  expect(acknowledgedStart(path, head)).toBeUndefined();
});

/** A trusted clone whose `origin` is a local repository holding one commit, so a run fetches offline. */
function trustedClone(): { clone: string; commit: string; tree: string } {
  const origin = join(folder, 'origin');
  const clone = join(folder, 'trusted-clone');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', ...args],
      { cwd, encoding: 'utf8' },
    ).trim();
  mkdirSync(origin);
  git(origin, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(origin, 'a.txt'), 'a\n');
  git(origin, 'add', '.');
  git(origin, 'commit', '--quiet', '-m', 'a');
  git(folder, 'clone', '--quiet', origin, clone);
  return { clone, commit: git(clone, 'rev-parse', 'HEAD'), tree: git(clone, 'rev-parse', 'HEAD^{tree}') };
}

const EMPTY_OUTPUTS = {
  browser: 'false',
  full: 'false',
  full_reason: '',
  shards: '[]',
  midnight_until: '',
  static: '',
  sql: '',
  selected_lint: '',
  selected_static: '',
  selected_unit: '',
  selected_sql: '',
  selected_components: '',
  component_shards: '[]',
  selected_invoices: '',
};

/**
 * An executor that runs nothing, isolating unless `isolates` is false: Plan launches (onLaunch) and
 * plans no job, Check passes. Each writes its result as job.ts would, of the run its task names.
 */
function stubExecutors(
  tasks: ExecutorTask[],
  tree: string,
  isolates = true,
): (setup: ExecutorSetup) => Executors {
  return (setup) => {
    const host: Executor = {
      isolatesJobs: isolates,
      async run(task) {
        tasks.push(task);
        const { job } = task.unit;
        if (job === 'plan') task.onLaunch?.();
        const result: CiResult = {
          version: 1,
          job,
          shard: null,
          event: task.env.CI_EVENT === 'integration' ? 'integration' : 'main',
          tree,
          commit: setup.commit,
          base: null,
          status: 'passed',
          groups: [],
          planReason: 'Selection by diff',
          reusedFrom: null,
          listGrowthApproved: false,
          producer: task.env.CI_PRODUCER ?? null,
          runUrl: task.env.CI_RUN_URL ?? null,
          startedAt: '2026-11-21T08:00:00.000Z',
          completedAt: '2026-11-21T08:01:00.000Z',
          attempt: Number(task.env.CI_RUN_ATTEMPT),
          ...(job === 'plan'
            ? { plan: { jobs: ['plan', 'check'], skips: {}, shards: [], outputs: EMPTY_OUTPUTS } }
            : {}),
        };
        writeFileSync(join(task.env.CI_RESULTS_DIR ?? '', `${job}.json`), JSON.stringify(result));
        return { exitCode: 0, detail: 'stub' };
      },
    };
    const jobs: Executor = {
      isolatesJobs: isolates,
      run: async () => ({ exitCode: 1, detail: 'nothing planned' }),
    };
    return { host, jobs, release: () => undefined };
  };
}

const command = (
  repository: string,
  environment: Record<string, string>,
  executors: (setup: ExecutorSetup) => Executors,
) => {
  const errors: string[] = [];
  const ran = runCommitCommand({
    repository,
    environment: { PATH: process.env.PATH, HOME: folder, ...environment },
    executors,
    signal: new AbortController().signal,
    log: () => undefined,
    error: (line) => errors.push(line),
  });
  return ran.then((code) => ({ code, errors }));
};

test("the queue's --main-runner hook runs through an isolating executor: its start record pays the debt, and a second main run exits 3", async () => {
  const { clone, commit, tree } = trustedClone();
  const workRoot = join(folder, 'work');
  const runUrl = 'https://ci.example/queue/tick-1-main';
  const environment = {
    ...mainEnvironment({ commit, base: commit, prs: [7], runUrl, resultsDir: join(folder, 'main-1') }),
    CI_WORK_ROOT: workRoot,
    CI_PRODUCER: 'mac-standin',
    CI_LEDGER: join(folder, 'ledger.jsonl'),
    GH_TOKEN: 'queue-token',
  };
  // The process executor refuses the queue's call before anything starts.
  const refused = await command(clone, environment, processExecutors);
  expect(refused.code).toBe(2);
  expect(refused.errors.join('\n')).toContain('CI_QUEUE_MAIN_RUN');
  expect(acknowledgedStart(mainStartRecord(workRoot, commit), commit)).toBeUndefined();

  const tasks: ExecutorTask[] = [];
  const ran = await command(clone, environment, stubExecutors(tasks, tree));
  expect(ran.errors).toEqual([]);
  expect(ran.code).toBe(0);
  expect(tasks.map((task) => task.unit.job)).toEqual(['plan', 'check']);
  // The queue's own token never reaches a job.
  expect(tasks.some((task) => task.env.GH_TOKEN === 'queue-token')).toBe(false);
  expect(acknowledgedStart(mainStartRecord(workRoot, commit), commit)).toBe(runUrl);

  // A push's own main run of the commit afterwards runs nothing.
  const duplicate = await command(
    clone,
    { ...environment, CI_RUN_URL: 'https://ci.example/runs/push', CI_RESULTS_DIR: join(folder, 'main-2') },
    stubExecutors([], tree),
  );
  expect(duplicate.code).toBe(3);
  expect(duplicate.errors.join('\n')).toContain(`main's run of ${commit} started already: ${runUrl}`);
});

// Only a run whose jobs cannot reach the work root writes what the queue and a second main run read:
// a local main run through an executor that isolates nothing claims no commit and records no start.
test('a main run through an executor that isolates nothing leaves no claim or start record the queue reads', async () => {
  const { clone, commit, tree } = trustedClone();
  const workRoot = join(folder, 'work');
  const tasks: ExecutorTask[] = [];
  const ran = await command(
    clone,
    {
      CI_EVENT: 'main',
      CI_COMMIT: commit,
      CI_RUN_URL: 'https://ci.example/runs/local',
      CI_RESULTS_DIR: join(folder, 'results'),
      CI_WORK_ROOT: workRoot,
    },
    stubExecutors(tasks, tree, false),
  );
  expect(ran.errors).toEqual([]);
  expect(ran.code).toBe(0);
  expect(tasks.map((task) => task.unit.job)).toEqual(['plan', 'check']);
  expect(acknowledgedStart(mainStartRecord(workRoot, commit), commit)).toBeUndefined();
  expect(existsSync(join(workRoot, 'main-runs'))).toBe(false);
});

test("a main run whose commit's Plan another run left in the ledger exits 3, and the start record names that run", async () => {
  const { clone, commit, tree } = trustedClone();
  const workRoot = join(folder, 'work');
  const ledger = join(folder, 'ledger.jsonl');
  writeFileSync(ledger, `${JSON.stringify(receipt({ commit, tree }))}\n`);
  const duplicate = await command(
    clone,
    {
      CI_EVENT: 'main',
      CI_COMMIT: commit,
      CI_RUN_URL: 'https://ci.example/runs/2',
      CI_RESULTS_DIR: join(folder, 'results'),
      CI_WORK_ROOT: workRoot,
      CI_LEDGER: ledger,
      CI_PRODUCER: 'mac-standin',
    },
    stubExecutors([], tree),
  );
  expect(duplicate.code).toBe(3);
  expect(acknowledgedStart(mainStartRecord(workRoot, commit), commit)).toBe('https://ci.example/runs/1');
});

test("the queue's --runner hook runs a commit only the queue's clone holds through an isolating executor, and passes", async () => {
  const { clone, commit: main } = trustedClone();
  // The batch tip lives only in the queue's clone, under its run ref.
  const queue = join(folder, 'queue');
  execFileSync('git', ['clone', '--quiet', clone, queue]);
  writeFileSync(join(queue, 'b.txt'), 'b\n');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', ...args],
      { cwd: queue, encoding: 'utf8' },
    ).trim();
  git('add', '.');
  git('commit', '--quiet', '-m', 'b');
  const tip = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
  git('update-ref', `refs/ci-queue/runs/${tip.commit}`, tip.commit);
  const resultsDir = join(folder, 'integration-1');
  const environment = {
    ...integrationEnvironment({
      tip: { ...tip, pull: pull(7) },
      base: main,
      pulls: [pull(7)],
      runUrl: 'https://ci.example/queue/1',
      resultsDir,
      repository: queue,
    }),
    CI_WORK_ROOT: join(folder, 'work'),
    CI_PRODUCER: 'mac-standin',
  };
  const refused = await command(clone, environment, processExecutors);
  expect(refused.code).toBe(2);
  expect(refused.errors.join('\n')).toContain('CI_QUEUE_COMMIT');
  const ran = await command(clone, environment, stubExecutors([], tip.tree));
  expect(ran.errors).toEqual([]);
  expect(ran.code).toBe(0);
  expect(readResult(join(resultsDir, 'check.json'))).toMatchObject({ status: 'passed', commit: tip.commit });
});

// The CI App's publisher posts Check with its own credentials: the mirror's repository and token
// stay with the mirror executor.
test("the Check publisher never receives the CI mirror's repository or token", async () => {
  const { clone, commit, tree } = trustedClone();
  const publisher = join(folder, 'publish.sh');
  writeFileSync(publisher, `#!/usr/bin/env bash\nenv >> "${join(folder, 'publisher.env')}"\n`);
  chmodSync(publisher, 0o755);
  const ran = await command(
    clone,
    {
      CI_EVENT: 'pr',
      CI_COMMIT: commit,
      CI_RESULTS_DIR: join(folder, 'results'),
      CI_RUN_URL: 'https://ci.example/runs/9',
      CI_WORK_ROOT: join(folder, 'work'),
      CI_PRODUCER: 'ci-mirror',
      CI_PUBLISHER: publisher,
      CI_MIRROR_REPO: 'owner/mirror',
      CI_MIRROR_TOKEN: 'mirror-token',
    },
    stubExecutors([], tree),
  );
  // The run started and posted: the stub's Check, of another event, fails it.
  expect(ran.code, ran.errors.join('\n')).toBe(1);
  const seen = readFileSync(join(folder, 'publisher.env'), 'utf8');
  expect(seen).toContain('CI_RUN_URL=https://ci.example/runs/9');
  expect(seen).not.toContain('CI_MIRROR_TOKEN');
  expect(seen).not.toContain('CI_MIRROR_REPO');
});
