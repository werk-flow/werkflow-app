// A throwaway repository for the tests that run the real scripts/ci/job.ts (job.test.ts,
// job-mirror.test.ts): this checkout's job.ts and run.ts over its lib, a fake verify.ts gate and a
// fake planner, and the plan results those jobs run by.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CiResult, resultFileName } from '../ci/results';

/** This checkout, whose job.ts the fixtures copy. */
export const repository = resolve(import.meta.dir, '../../..');
export const RUN_URL = 'https://ci.example/runs/2';

/** Runs `job` of scripts/ci/job.ts in `root` with only the variables given, and the path to find bun and git. */
export function runJob(root: string, job: string, variables: Record<string, string>): number | null {
  return spawnSync(process.execPath, ['scripts/ci/job.ts', job], {
    cwd: root,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, ...variables },
    encoding: 'utf8',
  }).status;
}

export function inFolder(body: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'ci-job-'));
  try {
    body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

/**
 * A clean repository with this checkout's job.ts and run.ts and its lib, whose verify.ts is a fake
 * gate: it writes the environment it sees to $ENV_DUMP_DIR/<group list>.json and passes every group.
 * The build's package scripts call it too. Its ci-plan.ts selects the migration-order gate in Fast,
 * one SQL group and one component area, unless PLAN_OUTPUT replaces that selection, and can append
 * a receipt to a ledger while it plans.
 */
export function fixture(folder: string): string {
  const root = join(folder, 'repository');
  mkdirSync(join(root, 'scripts/ci'), { recursive: true });
  for (const file of ['job.ts', 'run.ts'])
    copyFileSync(join(repository, 'scripts/ci', file), join(root, 'scripts/ci', file));
  for (const link of ['lib', 'node_modules', 'tsconfig.json'])
    symlinkSync(join(repository, link), join(root, link));
  writeFileSync(
    join(root, 'scripts/verify.ts'),
    `import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
// CHANGE_CHECKOUT makes the gate change the checkout it tests: an edited input, or a new commit.
if (process.env.CHANGE_CHECKOUT) appendFileSync('scripts/ci-plan.ts', '// edited\\n');
if (process.env.CHANGE_CHECKOUT === 'commit')
  execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '--all', '--message', 'moved']);
const groups = process.argv.includes('--group') ? process.argv[process.argv.indexOf('--group') + 1] : process.argv[2];
writeFileSync(join(process.env.ENV_DUMP_DIR, groups + '.json'), JSON.stringify(process.env));
const report = join(process.env.ENV_DUMP_DIR, 'report.json');
writeFileSync(report, JSON.stringify({ results: groups.split(',').map((groupId) => ({ groupId, status: 'passed', durationMs: 1 })) }));
console.info('[verify] passed in 0.1 min (fake): ' + report);
`,
  );
  writeFileSync(
    join(root, 'scripts/ci-plan.ts'),
    `import { appendFileSync } from 'node:fs';
// PLAN_APPENDS: another run appends this receipt line to the file PLAN_LEDGER while the planner runs.
if (process.env.PLAN_APPENDS) appendFileSync(process.env.PLAN_LEDGER, process.env.PLAN_APPENDS + '\\n');
// PLAN_OUTPUT replaces the selection below.
appendFileSync(process.env.GITHUB_OUTPUT, process.env.PLAN_OUTPUT ?? 'browser=false\\nfull=false\\nfull_reason=\\nshards=[]\\nmidnight_until=\\nstatic=static:migration-order\\nsql=sql:grants\\nselected_lint=\\nselected_static=static:migration-order\\nselected_unit=\\nselected_sql=sql:grants\\nselected_components=ui:contracts:work\\ncomponent_shards=[{"shard":1,"groups":"ui:contracts:work"}]\\nselected_invoices=\\n');
`,
  );
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: { 'env:local': 'bun scripts/verify.ts env-local', build: 'bun scripts/verify.ts build' },
    }),
  );
  git(root, 'init', '--quiet');
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '--message', 'fixture');
  return root;
}

/** Every planner key a stored plan must hold, each with an empty selection. */
export const EMPTY_OUTPUTS = {
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

/** A passed plan of `RUN_URL` for the tree in `root`, whose Fast runs only the migration-order gate and the build. */
export function planOf(root: string, overrides: Partial<CiResult> = {}): CiResult {
  return {
    version: 1,
    job: 'plan',
    shard: null,
    event: 'integration',
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    commit: git(root, 'rev-parse', 'HEAD'),
    base: 'd'.repeat(40),
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac-standin',
    runUrl: RUN_URL,
    startedAt: '2026-11-20T20:00:00.000Z',
    completedAt: '2026-11-20T20:01:00.000Z',
    attempt: 1,
    plan: {
      jobs: ['plan', 'fast', 'check'],
      skips: {},
      shards: [],
      outputs: { ...EMPTY_OUTPUTS, selected_static: 'static:migration-order' },
    },
    ...overrides,
  };
}

export function writePlan(root: string, directory: string, overrides: Partial<CiResult> = {}): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, resultFileName('plan', null)), JSON.stringify(planOf(root, overrides)));
}
