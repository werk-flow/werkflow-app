// The runner rules scripts/ci/run-commit.ts enforces before anything runs: one orchestrator per run,
// a rerun that counts its attempt up, at most one `main` run per commit, no Check for a queue run,
// and a scheduler that never names a run its run-commit holds (scripts/ci/schedule.ts).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CiResult } from './results';
import { RUN_COMMIT_LOCK } from './run-commit';

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
    [{ CI_COMMIT: 'main' }, 'is no full commit id', undefined],
    [{ CI_RUN_ATTEMPT: '0' }, 'is no attempt number', undefined],
    [{ CI_QUEUE_COMMIT: head, CI_PUBLISHER: '/bin/true' }, 'A queue run posts no Check', undefined],
    // A second main run of one commit, such as a push trigger after the queue's own main run.
    [
      { CI_EVENT: 'main', CI_LEDGER: ledger },
      `main's run of ${head} started already: https://ci.example/runs/1`,
      undefined,
    ],
    // The same on one host before either Plan wrote: the first claims the commit.
    [
      { CI_EVENT: 'main' },
      `main's run of ${head} started already: https://ci.example/runs/3`,
      () => {
        mkdirSync(join(folder, 'work/main-runs'), { recursive: true });
        writeFileSync(join(folder, 'work/main-runs', head), 'https://ci.example/runs/3');
      },
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
    expect([cause, refused.status]).toEqual([cause, 2]);
    expect(refused.stderr).toContain(cause);
    // A refusal starts no workspace.
    expect([cause, existsSync(join(folder, 'work', 'host'))]).toEqual([cause, false]);
    rmSync(join(folder, 'work'), { recursive: true, force: true });
  }
  expect(readdirSync(results)).toEqual(['fast.json']);
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
