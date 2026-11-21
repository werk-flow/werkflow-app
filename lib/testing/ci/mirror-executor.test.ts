// The CI mirror executor (scripts/ci/mirror-executor.ts) on a throwaway repository, a bare remote as
// the mirror and a fake of GitHub's API that runs each pushed job as the scenario says: a job runs
// from one parentless commit holding only the mirror's workflow, its own result reaches the run's
// results directory, a forged or foreign one never does, a stop cancels the mirror run, old branches
// are swept, Fast's host part joins its mirror part, and the host's job cap holds. No network.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MirrorApi, MirrorJob, MirrorRun } from '../../../scripts/ci/mirror-api';
import { mirrorExecutors } from '../../../scripts/ci/mirror-executor';
import { DEFAULT_MIRROR_IDENTITY, pushMirrorCommit } from '../../../scripts/ci/mirror-push';
import { planIdentityOf } from './check';
import { CI_DAG, CI_JOBS } from './dag';
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
    groups: (unit.job === 'fast'
      ? groups.filter((id) => id !== 'static:docs' && id !== 'static:migration-order')
      : groups
    ).map((id) => ({ id, outcome: 'passed', durationMs: 5 })),
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
  /** Holds the run in progress while it returns true. */
  running?: () => boolean;
  attempt?: number;
  otherJobRan?: boolean;
  /** The result file the artifact holds, or the files it holds. */
  result?: (unit: Unit) => CiResult;
  files?: (unit: Unit, result: CiResult) => Record<string, string>;
  onRunsOf?: () => void;
  /** Told each time the mirror starts a run of a push, with the number of runs so far. */
  onRun?: (runs: number) => void;
};

type Fake = {
  api: MirrorApi;
  cancelled: number[];
  deleted: string[];
  calls: { runsOf: number };
};

function fakeMirror(scenario: Scenario = {}): Fake {
  const runs = new Map<string, MirrorRun & { unit: Unit }>();
  const fake = { cancelled: new Array<number>(), deleted: new Array<string>(), calls: { runsOf: 0 } };
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
    if (run.status !== 'completed' && !(scenario.running?.() ?? false)) {
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
    branchHead: async (branch) => branchHead(branch),
    async commit(sha) {
      return {
        tree: scenario.tree ?? git(remote, 'rev-parse', `${sha}^{tree}`),
        committedAt: new Date(git(remote, 'log', '-1', '--format=%cI', sha)),
      };
    },
    async runsOf(branch, sha) {
      fake.calls.runsOf += 1;
      scenario.onRunsOf?.();
      if (!runs.has(branch) && branchHead(branch) === sha) {
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
        scenario.onRun?.(runs.size);
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
      const result = (scenario.result ?? mirrorResult)(run.unit);
      const files = scenario.files?.(run.unit, result) ?? {
        [resultFileName(run.unit.job, run.unit.shard)]: JSON.stringify(result),
      };
      return zipOf(files);
    },
    async cancel(id) {
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

const executorsOf = (
  fake: Fake,
  jobCap = MIRROR_JOB_CAP,
  log: (line: string) => void = () => undefined,
): Executors =>
  mirrorExecutors(
    { source, commit, workRoot: join(folder, 'work'), runKey: 'run', replaceStack: false, log },
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
  const branch = mirrorBranch(commit, 1, SQL);
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

test('a mirror that does not hold the pushed tree fails the job before any run is read', async () => {
  const fake = fakeMirror({ tree: 'f'.repeat(40) });
  const outcome = await executorsOf(fake).jobs.run(task(SQL), new AbortController().signal);
  expect(outcome.exitCode, outcome.detail).toBeNull();
  expect(outcome.detail).toContain('is not the pushed tree');
  expect(fake.calls.runsOf).toBe(0);
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
  expect(fake.deleted).toEqual([mirrorBranch(commit, 1, SQL)]);
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
    [`refs/heads/ci/${'2'.repeat(40)}-a1/sql`, `refs/heads/${mirrorBranch(commit, 1, SQL)}`].sort(),
  );
});

test('Fast joins its mirror part and its host part, which runs the groups that read outside the tree on this host', async () => {
  const fast: Unit = { job: 'fast', shard: null };
  const host = mirrorResult(fast, {
    groups: ['static:docs', 'static:migration-order'].map((id) => ({ id, outcome: 'passed', durationMs: 7 })),
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
  // A host part that read another approval leaves no Fast result.
  rmSync(join(results, 'fast.json'));
  writeFileSync(join(folder, 'host-result.json'), JSON.stringify({ ...host, listGrowthApproved: true }));
  const split = await executorsOf(fakeMirror()).jobs.run(task(fast), new AbortController().signal);
  expect(split.exitCode, split.detail).toBe(1);
  expect(split.detail).toContain('different list growth approvals');
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
  expect(MIRROR_JOB_CAP).toBe(16);
});
