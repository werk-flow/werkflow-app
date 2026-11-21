// The runner rules scripts/ci/run-commit.ts enforces before anything runs: one orchestrator per run,
// a rerun that counts its attempt up, at most one `main` run per commit, no Check for a queue run,
// and a scheduler that never names a run its run-commit holds (scripts/ci/schedule.ts).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CiResult } from './results';
import {
  acknowledgedStart,
  acknowledgeStart,
  claimMainRun,
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
      CI_JOB_USER: 'nobody',
      CI_START_ACK: join(folder, 'started.json'),
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
    [{ CI_JOB_USER: '' }, 'CI_JOB_USER names the user every job runs as', undefined],
    [
      { CI_JOB_USER: execFileSync('id', ['-un'], { encoding: 'utf8' }).trim() },
      'is the user run-commit runs as',
      undefined,
    ],
    [{ CI_JOB_USER: 'root' }, 'is the user run-commit runs as', undefined],
    // A failure no check names, such as a results directory that is a file, is a refusal too.
    [{}, 'the run could not start', () => (rmSync(results, { recursive: true }), writeFileSync(results, ''))],
    [{ CI_COMMIT: 'main' }, 'is no full commit id', undefined],
    [{ CI_RUN_ATTEMPT: '0' }, 'is no attempt number', undefined],
    [{ CI_QUEUE_COMMIT: head, CI_PUBLISHER: '/bin/true' }, 'A queue run posts no Check', undefined],
    // A second main run of one commit, such as a push trigger after the queue's own main run.
    [
      { CI_EVENT: 'main', CI_LEDGER: ledger },
      `main's run of ${head} started already: https://ci.example/runs/1`,
      undefined,
    ],
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
    // 3: another main run of the commit started, so nothing ran; 2: any other refusal.
    expect([cause, refused.status]).toEqual([cause, cause.startsWith("main's run") ? 3 : 2]);
    expect(refused.stderr).toContain(cause);
    // A refusal starts no workspace and claims no main commit. Only another run's durable start
    // pays an owed main run.
    expect([cause, existsSync(join(folder, 'work'))]).toEqual([cause, false]);
    expect([cause, acknowledgedStart(join(folder, 'started.json'), head)]).toEqual([
      cause,
      cause.startsWith("main's run") ? 'https://ci.example/runs/1' : undefined,
    ]);
    rmSync(join(folder, 'work'), { recursive: true, force: true });
    rmSync(join(folder, 'started.json'), { force: true });
  }
  expect(readdirSync(results)).toEqual(['fast.json']);
});

// Exit 3 tells the queue that another run pays its owed main run, so it needs that run's durable
// start: a claim whose run has not started yet, or died before it, is a refusal, and the debt stays.
test("a second main run of a commit exits 3 only once the claiming run's start is acknowledged", () => {
  const claims = join(folder, 'work', 'main-runs');
  claimMainRun(claims, head, 'https://ci.example/runs/1');
  const unstarted = runCommit({ CI_EVENT: 'main' });
  expect(unstarted.status).toBe(2);
  expect(unstarted.stderr).toContain('https://ci.example/runs/1 claimed it but has not started');
  expect(acknowledgedStart(join(folder, 'started.json'), head)).toBeUndefined();
  acknowledgeStart(join(claims, `${head}.started`), { commit: head, runUrl: 'https://ci.example/runs/1' });
  const duplicate = runCommit({ CI_EVENT: 'main' });
  expect(duplicate.status).toBe(3);
  expect(acknowledgedStart(join(folder, 'started.json'), head)).toBe('https://ci.example/runs/1');
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
    CI_JOB_USER: 'nobody',
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
