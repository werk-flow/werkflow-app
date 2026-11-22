// The CI mirror executor (scripts/ci/mirror-executor.ts) on a throwaway repository, a bare remote as
// the mirror and a fake of GitHub's API that runs each pushed job as the scenario says: a job runs
// from one parentless commit holding only the mirror's workflow, its own result reaches the run's
// results directory, a forged or foreign one never does, a stop cancels the mirror run, old branches
// are swept, Fast's host part joins its mirror part, and the host's job cap holds. No network.
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MirrorApi, MirrorJob, MirrorRun } from '../../../scripts/ci/mirror-api';
import { mirrorExecutors } from '../../../scripts/ci/mirror-executor';
import { DEFAULT_MIRROR_IDENTITY, pushMirrorCommit } from '../../../scripts/ci/mirror-push';
import { planIdentityOf } from './check';
import { CI_DAG, CI_JOBS, partGroups } from './dag';
import { HELD_WORKFLOWS, MIRROR_JOB_CAP, MIRROR_WORKFLOW, mirrorBranch } from './mirror';
import { parseMirrorMessage } from './mirror-message';
import { type CiResult, type RunPlan, readResult, resultFileName } from './results';
import type { Executors, ExecutorTask, Unit } from './run-commit';
import { plannedGroups } from './run-plan';

const RUN_URL = 'https://ci.example/runs/1';
const WORKFLOW = 'name: CI mirror\n';
/** The fixed instant of every test: the executor's clock, the Plan's and the results' times. */
const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const SHARDS = [1, 2, 3].map((shard) => ({ shard, groups: `golden:g${shard}` }));
const OUTPUTS: Record<string, string> = {
  browser: 'true',
  full: 'false',
  full_reason: '',
  shards: JSON.stringify(SHARDS),
  midnight_until: '',
  static: '',
  sql: '',
  selected_lint: 'static:lint',
  selected_static: 'static:docs,static:migration-order,static:format',
  selected_unit: 'unit:all',
  selected_sql: 'sql:grants',
  selected_components: '',
  component_shards: '[]',
  selected_invoices: '',
};
const PLAN: RunPlan = {
  jobs: ['plan', 'fast', 'sql', 'browser', 'check'],
  skips: { components: 'None.', invoices: 'None.', midnight: 'None.' },
  shards: SHARDS,
  outputs: OUTPUTS,
};

let folder = '';
let source = '';
let remote = '';
let results = '';
let commit = '';
let tree = '';
let planResult: CiResult;
const saved = { ...process.env };

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Owner',
      '-c',
      'user.email=owner@example.invalid',
      '-c',
      'commit.gpgSign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  ).trim();

// Fast's host part runs these through the process executor: prepare.ts does nothing, and job.ts
// records its environment and writes the host part's result the test placed in HOME.
const HOST_JOB = `
import { copyFileSync, writeFileSync } from 'node:fs';
writeFileSync(process.env.HOME + '/host-part.env', ['CI_PART', 'CI_RESULTS_DIR', 'GH_TOKEN'].map((name) => name + '=' + (process.env[name] ?? '')).join('\\n'));
copyFileSync(process.env.HOME + '/host-result.json', process.env.CI_RESULTS_DIR + '/fast.json');
`;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'mirror-executor-'));
  source = join(folder, 'source');
  remote = join(folder, 'mirror.git');
  results = join(folder, 'results');
  for (const [path, text] of Object.entries({
    'README.md': 'The app\n',
    'scripts/ci/prepare.ts': '',
    'scripts/ci/job.ts': HOST_JOB,
    '.github/workflows/ci.yml': 'name: CI\n',
    '.github/workflows/release.yml': 'name: Release\n',
  })) {
    mkdirSync(join(source, path, '..'), { recursive: true });
    writeFileSync(join(source, path), text);
  }
  git(folder, 'init', '--quiet', '--initial-branch=main', source);
  git(source, 'add', '.');
  git(source, 'commit', '--quiet', '-m', 'source');
  commit = git(source, 'rev-parse', 'HEAD');
  tree = git(source, 'rev-parse', 'HEAD^{tree}');
  git(source, 'update-ref', 'refs/remotes/origin/main', commit);
  git(folder, 'init', '--quiet', '--bare', remote);
  mkdirSync(results);
  planResult = {
    version: 1,
    job: 'plan',
    shard: null,
    event: 'integration',
    tree,
    commit,
    base: 'b'.repeat(40),
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'ci-mirror',
    runUrl: RUN_URL,
    startedAt: new Date(NOW - 60_000).toISOString(),
    completedAt: new Date(NOW - 30_000).toISOString(),
    attempt: 1,
    plan: PLAN,
  };
  writeFileSync(join(results, 'plan.json'), JSON.stringify(planResult));
  process.env.HOME = folder;
});

afterEach(() => {
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
  Object.assign(process.env, saved);
  rmSync(folder, { recursive: true, force: true });
});

const unitOf = (branch: string): Unit => {
  const name = branch.split('/').at(-1) ?? '';
  const [job = '', shard] = name.split('-');
  const known = CI_JOBS.find((candidate) => candidate === job);
  if (!known) throw new Error(`no job in ${branch}`);
  return { job: known, shard: shard === undefined ? null : Number(shard) };
};

/** The result a mirror job writes for `unit`: this run's own, passed, on the source tree. */
function mirrorResult(unit: Unit, overrides: Partial<CiResult> = {}): CiResult {
  const now = NOW;
  const groups = plannedGroups(
    unit.job,
    OUTPUTS,
    PLAN.shards.find((entry) => entry.shard === unit.shard)?.groups,
  );
  return {
    ...planResult,
    plan: undefined,
    job: unit.job,
    shard: unit.shard,
    groups: partGroups(groups, 'tree').map((id) => ({ id, outcome: 'passed', durationMs: 5 })),
    startedAt: new Date(now).toISOString(),
    completedAt: new Date(now + 1000).toISOString(),
    planIdentity: planIdentityOf(planResult, PLAN),
    ...overrides,
  };
}

type Scenario = {
  /** The pushed commit's tree as the API reports it, when it lies. */
  tree?: string;
  conclusion?: string;
  /** Holds a run in progress while it returns true for the run's id. */
  running?: (id: number) => boolean;
  attempt?: number;
  /** The branch cannot be read once it exists, as when the API fails right after a push. */
  unreadableBranch?: boolean;
  cancelFails?: () => boolean;
  /** The mirror reruns the job once its result artifact was downloaded. */
  rerunAfterDownload?: boolean;
  otherJobRan?: boolean;
  /** The result file the artifact holds, or the files it holds. */
  result?: (unit: Unit) => CiResult;
  files?: (unit: Unit, result: CiResult) => Record<string, string>;
  onRunsOf?: () => void;
  /** Told each time the mirror starts a run of a push, with the number of runs so far and its branch. */
  onRun?: (runs: number, branch: string) => void;
  /** Holds back the run of a push to `branch` while it returns false, as a mirror slow to start it. */
  startsRun?: (branch: string) => boolean;
};

type Fake = {
  api: MirrorApi;
  cancelled: number[];
  deleted: string[];
};

function fakeMirror(scenario: Scenario = {}): Fake {
  const runs = new Map<string, MirrorRun & { unit: Unit }>();
  const fake = { cancelled: new Array<number>(), deleted: new Array<string>() };
  let nextId = 1;
  const branchHead = (branch: string): string | undefined => {
    const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
      cwd: remote,
      encoding: 'utf8',
    });
    return head.status === 0 ? head.stdout.trim() : undefined;
  };
  const runById = (id: number) => {
    const found = [...runs.values()].find((run) => run.id === id);
    if (!found) throw new Error(`no run ${id}`);
    return found;
  };
  const settle = (run: MirrorRun) => {
    if (run.status !== 'completed' && !(scenario.running?.(run.id) ?? false)) {
      run.status = 'completed';
      run.conclusion = scenario.conclusion ?? 'success';
    }
    return { ...run };
  };
  const zipOf = (files: Record<string, string>): Uint8Array => {
    const zipFolder = mkdtempSync(join(folder, 'zip-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(zipFolder, name), text);
    execFileSync('zip', [
      '-q',
      '-j',
      join(zipFolder, 'out.zip'),
      ...Object.keys(files).map((name) => join(zipFolder, name)),
    ]);
    return new Uint8Array(readFileSync(join(zipFolder, 'out.zip')));
  };
  const api: MirrorApi = {
    async branchHead(branch) {
      const head = branchHead(branch);
      if (head && scenario.unreadableBranch) throw new Error('GitHub GET /git/ref answered 502.');
      return head;
    },
    async commit(sha) {
      return {
        tree: scenario.tree ?? git(remote, 'rev-parse', `${sha}^{tree}`),
        committedAt: new Date(git(remote, 'log', '-1', '--format=%cI', sha)),
      };
    },
    async runsOf(branch, sha) {
      scenario.onRunsOf?.();
      if (!runs.has(branch) && branchHead(branch) === sha && (scenario.startsRun?.(branch) ?? true)) {
        runs.set(branch, {
          id: nextId++,
          path: MIRROR_WORKFLOW,
          head_sha: sha,
          head_branch: branch,
          event: 'push',
          status: 'queued',
          conclusion: null,
          run_attempt: scenario.attempt ?? 1,
          unit: unitOf(branch),
        });
        scenario.onRun?.(runs.size, branch);
      }
      const run = runs.get(branch);
      return run ? [settle(run)] : [];
    },
    run: async (id) => settle(runById(id)),
    async jobs(id) {
      const run = runById(id);
      return Object.values(CI_DAG)
        .filter((spec) => spec.name !== 'Plan' && spec.name !== 'Check')
        .map(
          (spec): MirrorJob =>
            spec.name === CI_DAG[run.unit.job].name
              ? { name: spec.name, status: 'completed', conclusion: run.conclusion }
              : {
                  name: spec.name,
                  status: 'completed',
                  conclusion: scenario.otherJobRan ? 'success' : 'skipped',
                },
        );
    },
    async artifacts(id) {
      const run = runById(id);
      const name = run.unit.shard === null ? run.unit.job : `${run.unit.job}-${run.unit.shard}`;
      return [{ id: id * 10, name: `ci-result-${name}`, expired: false, workflow_run: { id } }];
    },
    async download(artifactId) {
      const run = runById(artifactId / 10);
      if (scenario.rerunAfterDownload) run.run_attempt = 2;
      const result = (scenario.result ?? mirrorResult)(run.unit);
      const files = scenario.files?.(run.unit, result) ?? {
        [resultFileName(run.unit.job, run.unit.shard)]: JSON.stringify(result),
      };
      return zipOf(files);
    },
    async cancel(id) {
      if (scenario.cancelFails?.()) throw new Error('GitHub POST /actions/runs/cancel answered 500.');
      fake.cancelled.push(id);
      const run = runById(id);
      run.status = 'completed';
      run.conclusion = 'cancelled';
    },
    async ciBranches() {
      const listed = git(
        remote,
        'for-each-ref',
        '--format=%(refname:lstrip=2) %(objectname)',
        'refs/heads/ci/',
      );
      return listed
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name = '', sha = ''] = line.split(' ');
          return { name, sha };
        });
    },
    async deleteBranch(branch) {
      fake.deleted.push(branch);
      git(remote, 'update-ref', '-d', `refs/heads/${branch}`);
    },
  };
  return { ...fake, api };
}

const RUN_KEY = '0123456789abcdef-1';
const executorsOf = (
  fake: Fake,
  jobCap = MIRROR_JOB_CAP,
  log: (line: string) => void = () => undefined,
  runKey = RUN_KEY,
): Executors =>
  mirrorExecutors(
    { source, commit, workRoot: join(folder, 'work'), runKey, replaceStack: false, log },
    {
      api: fake.api,
      push: (pushed, branch) =>
        pushMirrorCommit({ repository: source, remote, commit: pushed, branch, token: undefined }),
      workflow: WORKFLOW,
      identity: DEFAULT_MIRROR_IDENTITY,
      now: () => NOW,
      // Every wait only yields: the fake mirror moves by the scenario, never by the clock.
      sleep: () => new Promise((resolve) => setImmediate(resolve)),
      pollMs: 1,
      jobCap,
    },
  );

const task = (unit: Unit, env: Record<string, string> = {}): ExecutorTask => ({
  unit,
  env: {
    CI_EVENT: 'integration',
    CI_RUN_URL: RUN_URL,
    CI_RUN_ATTEMPT: '1',
    CI_RESULTS_DIR: results,
    CI_PRODUCER: 'ci-mirror',
    CI_PRS: '12',
    GH_TOKEN: 'job-token',
    ...env,
  },
  prepareEnv: { SIBLING_REPOSITORIES_TOKEN: 'sibling-token' },
  timeoutMs: 60_000,
});

const SQL: Unit = { job: 'sql', shard: null };
const done = (executors: Executors, exitCode: number) =>
  executors.release({ exitCode: exitCode === 0 ? 0 : 1, units: [], scheduler: {} });

test("a job runs on the mirror from one parentless commit of the source tree, and its own result reaches the run's results", async () => {
  const fake = fakeMirror();
  const executors = executorsOf(fake);
  const outcome = await executors.jobs.run(task(SQL), new AbortController().signal);
  expect(outcome.exitCode, outcome.detail).toBe(0);
  const written = readResult(join(results, 'sql.json'));
  expect(written).toMatchObject({ job: 'sql', status: 'passed', tree, commit, runUrl: RUN_URL });
  const branch = mirrorBranch(commit, RUN_KEY, SQL);
  const pushed = git(remote, 'rev-parse', `refs/heads/${branch}`);
  expect(git(remote, 'rev-list', '--parents', '-n', '1', pushed)).toBe(pushed);
  const paths = git(remote, 'ls-tree', '-r', '--name-only', pushed).split('\n');
  expect(paths.filter((path) => path.startsWith('.github/workflows/'))).toEqual([MIRROR_WORKFLOW]);
  expect(paths).toContain(`${HELD_WORKFLOWS}/ci.yml`);
  // The message holds the run without a token, a host path or a pull request ref.
  const message = parseMirrorMessage(git(remote, 'log', '-1', '--format=%B', pushed));
  if ('problem' in message) throw new Error(message.problem);
  expect(message.variables).toEqual({
    CI_EVENT: 'integration',
    CI_RUN_URL: RUN_URL,
    CI_RUN_ATTEMPT: '1',
    CI_PRODUCER: 'ci-mirror',
    CI_PRS: '12',
  });
  expect(message.source).toEqual({ commit, tree });
  expect(git(remote, 'log', '-1', '--format=%B', pushed)).not.toMatch(/job-token|sibling-token|\/results/);
  // The branch goes once the run ended.
  await done(executors, 0);
  expect(fake.deleted).toContain(branch);
  expect(git(remote, 'for-each-ref', 'refs/heads/ci/')).toBe('');
});

test('a mirror that does not hold the pushed tree fails the job, reads no result and stops the run it started', async () => {
  const fake = fakeMirror({ tree: 'f'.repeat(40), running: () => true });
  const outcome = await executorsOf(fake).jobs.run(task(SQL), new AbortController().signal);
  expect(outcome.exitCode, outcome.detail).toBeNull();
  expect(outcome.detail).toContain('is not the pushed tree');
  expect(fake.cancelled).toEqual([1]);
  expect(existsSync(join(results, 'sql.json'))).toBe(false);
});

/** Runs SQL on the mirror once per case and expects each refused, with nothing in the results. */
async function expectRefused(cases: readonly (readonly [string, Scenario, string])[]): Promise<void> {
  for (const [name, scenario, detail] of cases) {
    rmSync(join(results, 'sql.json'), { force: true });
    const executors = executorsOf(fakeMirror(scenario));
    const outcome = await executors.jobs.run(task(SQL), new AbortController().signal);
    expect(outcome.exitCode, name).not.toBe(0);
    expect(outcome.detail, name).toContain(detail);
    expect(existsSync(join(results, 'sql.json')), name).toBe(false);
    await done(executors, 1);
  }
}

test('a forged or foreign result that names another run, attempt, tree, Plan or job never reaches the results', async () => {
  await expectRefused([
    [
      'another run',
      { result: (unit) => mirrorResult(unit, { runUrl: 'https://ci.example/runs/2' }) },
      'run https://ci.example/runs/2',
    ],
    ['another attempt', { result: (unit) => mirrorResult(unit, { attempt: 2 }) }, 'attempt 2'],
    ['the transformed tree', { result: (unit) => mirrorResult(unit, { tree: 'e'.repeat(40) }) }, 'tree'],
    ['another Plan', { result: (unit) => mirrorResult(unit, { planIdentity: undefined }) }, 'another Plan'],
    ['another job', { result: () => mirrorResult({ job: 'fast', shard: null }) }, 'job fast'],
  ]);
});

test('an artifact that holds more or other than the result, or a run that is not the pushed job alone, is refused', async () => {
  await expectRefused([
    [
      'a second file',
      {
        files: (unit, result) => ({
          [resultFileName(unit.job, unit.shard)]: JSON.stringify(result),
          'check.json': '{}',
        }),
      },
      'not sql.json alone',
    ],
    [
      'no result',
      { files: (unit) => ({ [resultFileName(unit.job, unit.shard)]: '{"version":2}' }) },
      'no valid result',
    ],
    ['a rerun on the mirror', { attempt: 2 }, 'only a first attempt counts'],
    ['another job that ran', { otherJobRan: true }, 'the mirror run ran'],
    [
      'a rerun while the result was read',
      { rerunAfterDownload: true },
      'ran it again while its result was read',
    ],
  ]);
});

test("a failed mirror job's own result stays as its evidence, and a pass it did not end with is a failure", async () => {
  const failed = await executorsOf(
    fakeMirror({ conclusion: 'failure', result: (unit) => mirrorResult(unit, { status: 'failed' }) }),
  ).jobs.run(task(SQL), new AbortController().signal);
  expect(failed.exitCode, failed.detail).toBe(1);
  expect(readResult(join(results, 'sql.json'))).toMatchObject({ status: 'failed' });
  rmSync(join(results, 'sql.json'));
  const unearned = await executorsOf(fakeMirror({ conclusion: 'failure' })).jobs.run(
    task(SQL),
    new AbortController().signal,
  );
  expect(unearned.exitCode, unearned.detail).toBe(1);
  expect(readResult(join(results, 'sql.json'))).toMatchObject({ status: 'failed' });
});

test('a stop cancels the running mirror run, reads no result and deletes its branch', async () => {
  const controller = new AbortController();
  const fake = fakeMirror({
    running: () => true,
    onRunsOf: () => controller.abort(),
  });
  const executors = executorsOf(fake);
  const outcome = await executors.jobs.run(task(SQL), controller.signal);
  expect(outcome.exitCode, outcome.detail).toBeNull();
  expect(outcome.detail).toBe('the job was stopped');
  expect(fake.cancelled).toEqual([1]);
  expect(existsSync(join(results, 'sql.json'))).toBe(false);
  await done(executors, 1);
  expect(fake.deleted).toEqual([mirrorBranch(commit, RUN_KEY, SQL)]);
});

test('the first job start sweeps ci branches older than a day; fresh ones stay', async () => {
  const dated = (date: string) =>
    execFileSync('git', ['commit-tree', '-m', 'old', `${tree}`], {
      cwd: source,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'CI',
        GIT_AUTHOR_EMAIL: 'ci@ci.invalid',
        GIT_COMMITTER_NAME: 'CI',
        GIT_COMMITTER_EMAIL: 'ci@ci.invalid',
        GIT_COMMITTER_DATE: date,
        GIT_AUTHOR_DATE: date,
      },
    }).trim();
  const old = dated(new Date(NOW - 25 * 3_600_000).toISOString());
  const fresh = dated(new Date(NOW - 3_600_000).toISOString());
  git(
    source,
    'push',
    '--quiet',
    remote,
    `${old}:refs/heads/ci/${'1'.repeat(40)}-a1/sql`,
    `${fresh}:refs/heads/ci/${'2'.repeat(40)}-a1/sql`,
  );
  const fake = fakeMirror();
  const executors = executorsOf(fake);
  const swept = await executors.jobs.run(task(SQL), new AbortController().signal);
  expect(swept.exitCode, swept.detail).toBe(0);
  expect(fake.deleted).toEqual([`ci/${'1'.repeat(40)}-a1/sql`]);
  expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/ci/').split('\n').sort()).toEqual(
    [`refs/heads/ci/${'2'.repeat(40)}-a1/sql`, `refs/heads/${mirrorBranch(commit, RUN_KEY, SQL)}`].sort(),
  );
});

test('Fast joins its mirror part and its host part, which runs the groups that read outside the tree on this host', async () => {
  const fast: Unit = { job: 'fast', shard: null };
  const host = mirrorResult(fast, {
    groups: partGroups(plannedGroups('fast', OUTPUTS), 'host').map((id) => ({
      id,
      outcome: 'passed',
      durationMs: 7,
    })),
  });
  writeFileSync(join(folder, 'host-result.json'), JSON.stringify(host));
  const outcome = await executorsOf(fakeMirror()).jobs.run(task(fast), new AbortController().signal);
  expect(outcome.exitCode, outcome.detail).toBe(0);
  const written = readResult(join(results, 'fast.json'));
  if ('unreadable' in written) throw new Error(written.unreadable);
  expect(written.groups.map((group) => group.id)).toEqual(plannedGroups('fast', OUTPUTS));
  expect(written.status).toBe('passed');
  // The host part ran with its part, its own results directory and the job's GitHub token.
  const seen = readFileSync(join(folder, 'host-part.env'), 'utf8');
  expect(seen).toContain('CI_PART=host');
  expect(seen).toContain('GH_TOKEN=job-token');
  expect(seen).not.toContain(`CI_RESULTS_DIR=${results}\n`);
  // The approval is the host's, which read the labels and ran the one test that reads it.
  rmSync(join(results, 'fast.json'));
  writeFileSync(join(folder, 'host-result.json'), JSON.stringify({ ...host, listGrowthApproved: true }));
  const approved = await executorsOf(fakeMirror()).jobs.run(task(fast), new AbortController().signal);
  expect(approved.exitCode, approved.detail).toBe(0);
  expect(readResult(join(results, 'fast.json'))).toMatchObject({ listGrowthApproved: true });
  // A host part that ran the mirror's groups leaves no Fast result.
  rmSync(join(results, 'fast.json'));
  writeFileSync(join(folder, 'host-result.json'), JSON.stringify(mirrorResult(fast)));
  const swapped = await executorsOf(fakeMirror()).jobs.run(task(fast), new AbortController().signal);
  expect(swapped.exitCode, swapped.detail).toBe(1);
  expect(swapped.detail).toContain('the host part holds');
  expect(existsSync(join(results, 'fast.json'))).toBe(false);
});

test("a host's mirror job cap holds every run together: a job beyond it waits for a slot", async () => {
  let holding = true;
  const cap = 2;
  const started = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const fake = fakeMirror({
    running: () => holding,
    onRun: (count) => {
      if (count === cap) started.resolve();
    },
  });
  const log = (line: string) => {
    if (line.includes(`${cap} mirror jobs run on this host`)) waiting.resolve();
  };
  // Two runs of the host, each with its own executors, share the host's slots.
  const runs = [executorsOf(fake, cap, log), executorsOf(fake, cap, log)];
  const shards = SHARDS.map((entry): Unit => ({ job: 'browser', shard: entry.shard }));
  const outcomes = Promise.all(
    shards.map((unit, index) => runs[index % 2]?.jobs.run(task(unit), new AbortController().signal)),
  );
  const pushed = () => git(remote, 'for-each-ref', 'refs/heads/ci/').split('\n').filter(Boolean).length;
  await Promise.all([started.promise, waiting.promise]);
  expect(pushed()).toBe(cap);
  holding = false;
  expect((await outcomes).map((outcome) => outcome?.exitCode)).toEqual([0, 0, 0]);
  expect(pushed()).toBe(cap + 1);
  expect(MIRROR_JOB_CAP).toBe(56);
});

test("two runs of one commit push their own branches, and one run's cleanup leaves the other's branch", async () => {
  const fake = fakeMirror();
  const pullRequestRun = executorsOf(fake, MIRROR_JOB_CAP, () => undefined, 'aaaaaaaaaaaaaaaa-1');
  const queueRun = executorsOf(fake, MIRROR_JOB_CAP, () => undefined, 'bbbbbbbbbbbbbbbb-1');
  for (const executors of [pullRequestRun, queueRun]) {
    const outcome = await executors.jobs.run(task(SQL), new AbortController().signal);
    expect(outcome.exitCode, outcome.detail).toBe(0);
  }
  await done(pullRequestRun, 0);
  expect(git(remote, 'for-each-ref', '--format=%(refname)', 'refs/heads/ci/')).toBe(
    `refs/heads/${mirrorBranch(commit, 'bbbbbbbbbbbbbbbb-1', SQL)}`,
  );
});

test('the executors read the source tree only at a job start, after run-commit fetched the commit', () => {
  const absent = 'f'.repeat(40);
  expect(() =>
    mirrorExecutors(
      {
        source,
        commit: absent,
        workRoot: join(folder, 'work'),
        runKey: RUN_KEY,
        replaceStack: false,
        log: () => undefined,
      },
      {
        api: fakeMirror().api,
        push: () => undefined,
        workflow: WORKFLOW,
        identity: DEFAULT_MIRROR_IDENTITY,
        now: () => NOW,
        sleep: () => Promise.resolve(),
        pollMs: 1,
        jobCap: 1,
      },
    ),
  ).not.toThrow();
});

test("a failure after the push cancels the push's run and frees its slot only once the run ended", async () => {
  let holding = true;
  const fake = fakeMirror({ running: () => holding, unreadableBranch: true });
  const executors = executorsOf(fake, 1);
  const failed = await executors.jobs.run(task(SQL), new AbortController().signal);
  expect(failed.exitCode, failed.detail).toBeNull();
  expect(failed.detail).toContain('502');
  expect(fake.cancelled).toEqual([1]);
  // The one slot is free again: the next job runs.
  holding = false;
  const next = await executorsOf(fakeMirror(), 1, () => undefined, 'fedcba9876543210-1').jobs.run(
    task({ job: 'browser', shard: 1 }),
    new AbortController().signal,
  );
  expect(next.exitCode, next.detail).toBe(0);
});

test('a run whose end cannot be told keeps its slot, so the cap never counts it free', async () => {
  const controller = new AbortController();
  const fake = fakeMirror({
    running: () => true,
    cancelFails: () => true,
    onRunsOf: () => controller.abort(),
  });
  const stopped = await executorsOf(fake, 1).jobs.run(task(SQL), controller.signal);
  expect(stopped.exitCode, stopped.detail).toBeNull();
  const waiting = Promise.withResolvers<void>();
  const second = new AbortController();
  const next = executorsOf(
    fakeMirror(),
    1,
    (line) => {
      if (line.includes('1 mirror jobs run on this host')) waiting.resolve();
    },
    'fedcba9876543210-1',
  ).jobs.run(task({ job: 'browser', shard: 1 }), second.signal);
  await waiting.promise;
  second.abort();
  const outcome = await next;
  expect(outcome.exitCode, outcome.detail).toBeNull();
  expect(outcome.detail).toBe('stopped before a mirror slot was free');
});

test("a slot's push record is renamed into place whole, so a holder that dies mid-write never leaves it unreadable", async () => {
  const written = spyOn(fs, 'writeFileSync');
  try {
    const ran = await executorsOf(fakeMirror(), 1).jobs.run(task(SQL), new AbortController().signal);
    expect(ran.exitCode, ran.detail).toBe(0);
    const paths = written.mock.calls.map(([path]) => String(path));
    expect(paths.filter((path) => /slot-\d+\.push\.tmp$/.test(path))).toHaveLength(1);
    expect(paths.filter((path) => /slot-\d+\.push$/.test(path))).toEqual([]);
  } finally {
    written.mockRestore();
  }
});

test('a slot whose holder died with its run unsettled is taken only after that run was cancelled and ended', async () => {
  const controller = new AbortController();
  let cancelFails = true;
  // The dead holder's run goes until it is cancelled; the new job's run ends by itself.
  const fake = fakeMirror({
    running: (id) => id === 1,
    cancelFails: () => cancelFails,
    onRunsOf: () => controller.abort(),
  });
  const first = await executorsOf(fake, 1, () => undefined).jobs.run(task(SQL), controller.signal);
  expect(first.exitCode, first.detail).toBeNull();
  expect(fake.cancelled).toEqual([]);
  // The holder dies: its lock names a process that is gone; its record stays.
  const gone = spawnSync('true').pid;
  writeFileSync(join(folder, 'work/mirror-slots/slot-0'), String(gone));
  cancelFails = false;
  const next = await executorsOf(fake, 1, () => undefined, 'fedcba9876543210-1').jobs.run(
    task({ job: 'browser', shard: 1 }),
    new AbortController().signal,
  );
  expect(next.exitCode, next.detail).toBe(0);
  expect(fake.cancelled).toEqual([1]);
  expect(existsSync(join(folder, 'work/mirror-slots/slot-0.push'))).toBe(false);
});

/**
 * A holder that died with its push recorded and its run not yet started: the push to `SQL`'s branch,
 * its record and a lock that names a gone process. The scenario's run of that push starts once
 * `start` is called; the returned branch's ref is dropped when `landed` is false, as a push the dead
 * holder left in flight. Run ids count from 1 in the order the mirror starts them.
 */
async function diedBeforeItsRunStarted(scenario: Scenario, landed: boolean) {
  let started = false;
  // The dead holder's run goes until it is cancelled; every other run ends by itself.
  let deadRun: number | undefined;
  Object.assign(scenario, {
    unreadableBranch: true,
    startsRun: (branch: string) => started || !branch.endsWith('/sql'),
    onRun: (runs: number, branch: string) => {
      if (branch.endsWith('/sql')) deadRun = runs;
    },
    running: (id: number) => id === deadRun,
  });
  const fake = fakeMirror(scenario);
  const first = await executorsOf(fake, 1).jobs.run(task(SQL), new AbortController().signal);
  expect(first.exitCode, first.detail).toBeNull();
  expect(existsSync(join(folder, 'work/mirror-slots/slot-0.push'))).toBe(true);
  const [branch = '', pushed = ''] = git(
    remote,
    'for-each-ref',
    '--format=%(refname:lstrip=2) %(objectname)',
    'refs/heads/ci/',
  ).split(' ');
  writeFileSync(join(folder, 'work/mirror-slots/slot-0'), String(spawnSync('true').pid));
  scenario.unreadableBranch = false;
  if (!landed) git(remote, 'update-ref', '-d', `refs/heads/${branch}`);
  return { fake, branch, pushed, start: () => (started = true) };
}

test("a dead holder's push whose run has not started yet keeps its slot until that run started and ended", async () => {
  const scenario: Scenario = {};
  const dead = await diedBeforeItsRunStarted(scenario, true);
  let reads = 0;
  scenario.onRunsOf = () => {
    reads += 1;
    if (reads === 3) dead.start();
  };
  const next = await executorsOf(dead.fake, 1, () => undefined, 'fedcba9876543210-1').jobs.run(
    task({ job: 'browser', shard: 1 }),
    new AbortController().signal,
  );
  expect(next.exitCode, next.detail).toBe(0);
  // The dead holder's run started first and was cancelled before the slot's next job pushed.
  expect(dead.fake.cancelled).toEqual([1]);
});

test("a dead holder's push still in flight keeps its slot until it landed and its run ended", async () => {
  const scenario: Scenario = {};
  const dead = await diedBeforeItsRunStarted(scenario, false);
  let reads = 0;
  scenario.onRunsOf = () => {
    reads += 1;
    if (reads === 3) {
      git(remote, 'update-ref', `refs/heads/${dead.branch}`, dead.pushed);
      dead.start();
    }
  };
  const next = await executorsOf(dead.fake, 1, () => undefined, 'fedcba9876543210-1').jobs.run(
    task({ job: 'browser', shard: 1 }),
    new AbortController().signal,
  );
  expect(next.exitCode, next.detail).toBe(0);
  // The dead holder's run started first and was cancelled before the slot's next job pushed.
  expect(dead.fake.cancelled).toEqual([1]);
});
