// The first step of a CI mirror job (scripts/ci/mirror-job.ts) on a throwaway checkout whose commit
// message holds the run: it writes the run's Plan and passes the run's variables and the tree part to
// the later steps, and refuses a commit that runs another job or no mirror run at all.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mirrorMessage, type MirrorRun, parseMirrorDeferral } from './mirror-message';

const SCRIPT = resolve(import.meta.dir, '../../../scripts/ci/mirror-job.ts');
let folder = '';

const RUN: MirrorRun = {
  version: 1,
  job: 'browser',
  shard: 3,
  source: { commit: 'c'.repeat(40), tree: 'a'.repeat(40) },
  variables: { CI_EVENT: 'integration', CI_RUN_URL: 'https://ci.example/runs/1', CI_RUN_ATTEMPT: '2' },
  plan: { job: 'plan', runUrl: 'https://ci.example/runs/1' },
};

function checkout(message: string): string {
  const root = join(folder, `checkout-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root);
  writeFileSync(join(root, 'README.md'), 'tree\n');
  const git = (args: string[], input?: string) =>
    execFileSync('git', ['-c', 'user.name=CI mirror', '-c', 'user.email=ci-mirror@ci.invalid', ...args], {
      cwd: root,
      input,
    });
  git(['init', '--quiet']);
  git(['add', '.']);
  git(['commit', '--quiet', '--no-gpg-sign', '-F', '-'], message);
  return root;
}

/** Noon Berlin: the midnight start rule lets every job start. */
const NOON = '2026-11-21T11:00:00.000Z';

function run(
  root: string,
  job: string,
  now = NOON,
): { status: number | null; output: string; env: string; outputs: string } {
  const env = join(folder, 'env');
  const outputs = join(folder, 'outputs');
  writeFileSync(env, '');
  writeFileSync(outputs, '');
  const ran = spawnSync(process.execPath, [SCRIPT, job], {
    cwd: root,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      GITHUB_ENV: env,
      GITHUB_OUTPUT: outputs,
      RUNNER_TEMP: join(folder, 'temp'),
      MIRROR_JOB_NOW: now,
    },
  });
  return {
    status: ran.status,
    output: `${ran.stdout}${ran.stderr}`,
    env: readFileSync(env, 'utf8'),
    outputs: readFileSync(outputs, 'utf8'),
  };
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'mirror-job-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

test("a mirror job writes its run's Plan and passes the run's variables and the tree part to its steps", () => {
  const ran = run(checkout(mirrorMessage(RUN)), 'browser');
  expect(ran.status, ran.output).toBe(0);
  const results = join(folder, 'temp/ci-results');
  expect(JSON.parse(readFileSync(join(results, 'plan.json'), 'utf8'))).toEqual(RUN.plan);
  expect(ran.env.split('\n').filter(Boolean).sort()).toEqual(
    [
      'CI_EVENT=integration',
      'CI_RUN_URL=https://ci.example/runs/1',
      'CI_RUN_ATTEMPT=2',
      `CI_RESULTS_DIR=${results}`,
      'CI_PART=tree',
      'CI_SHARD=3',
    ].sort(),
  );
  expect(ran.outputs).toBe(`unit=browser-3\nresult=${join(results, 'browser-3.json')}\n`);
});

test('a mirror job refuses a commit that runs another job, a shard that does not fit, or no mirror run', () => {
  const root = checkout(mirrorMessage(RUN));
  expect(run(root, 'fast').output).toContain('This commit runs browser, not fast.');
  const unsharded = checkout(mirrorMessage({ ...RUN, shard: null }));
  expect(run(unsharded, 'browser').output).toContain('does not fit browser');
  const plain = run(checkout('A feature\n'), 'browser');
  expect([plain.status, plain.env]).toEqual([1, '']);
  expect(plain.output).toContain('no CI mirror run');
});

test('a Browser job that GitHub started at 23:41 Berlin runs nothing and leaves its deferral as its result', () => {
  const ran = run(checkout(mirrorMessage(RUN)), 'browser', '2026-11-21T22:41:00.000Z');
  expect(ran.status, ran.output).toBe(1);
  expect(ran.output).toContain('browser-3 started where its timeout could reach the midnight start window');
  const results = join(folder, 'temp/ci-results');
  // The result step keeps the deferral; no later step runs, so the job gets no variables or Plan.
  expect(ran.outputs).toBe(`unit=browser-3\nresult=${join(results, 'browser-3.json')}\n`);
  expect(parseMirrorDeferral(readFileSync(join(results, 'browser-3.json'), 'utf8'))?.toISOString()).toBe(
    '2026-11-21T22:41:00.000Z',
  );
  expect(ran.env).toBe('');
  expect(existsSync(join(results, 'plan.json'))).toBe(false);
  // Any other job starts then: only a Browser job's groups wait for the window.
  const sql = run(
    checkout(mirrorMessage({ ...RUN, job: 'sql', shard: null })),
    'sql',
    '2026-11-21T22:41:00.000Z',
  );
  expect(sql.status, sql.output).toBe(0);
});
