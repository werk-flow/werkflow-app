// A job body keeps the runner contract of scripts/ci/job.ts: a CI Plan start always reaches the
// ledger, a job runs only by its own run's plan, its gates see the base that plan recorded, and no
// child process can write a receipt. Each case runs the real job.ts.
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CiResult, readLedger, readResult, resultFileName } from './results';

const repository = resolve(import.meta.dir, '../../..');
const RUN_URL = 'https://ci.example/runs/2';

/** Runs `job` of scripts/ci/job.ts in `root` with only the variables given, and the path to find bun and git. */
function runJob(root: string, job: string, variables: Record<string, string>): number | null {
  return spawnSync(process.execPath, ['scripts/ci/job.ts', job], {
    cwd: root,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, ...variables },
    encoding: 'utf8',
  }).status;
}

function inFolder(body: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'ci-job-'));
  try {
    body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();

/**
 * A clean repository with this checkout's job.ts and run.ts and its lib, whose verify.ts is a fake
 * gate: it writes the environment it sees to $ENV_DUMP_DIR/<group list>.json and passes every group.
 * The build's package scripts call it too. Its ci-plan.ts selects the migration-order gate in Fast,
 * one SQL group and one component area.
 */
function fixture(folder: string): string {
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
appendFileSync(process.env.GITHUB_OUTPUT, 'browser=false\\nfull=false\\nfull_reason=\\nshards=[]\\nmidnight_until=\\nstatic=static:migration-order\\nsql=sql:grants\\nselected_lint=\\nselected_static=static:migration-order\\nselected_unit=\\nselected_sql=sql:grants\\nselected_components=ui:contracts:work\\ncomponent_shards=[{"shard":1,"groups":"ui:contracts:work"}]\\n');
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
};

/** A passed plan of `RUN_URL` for the tree in `root`, whose Fast runs only the migration-order gate and the build. */
function planOf(root: string, overrides: Partial<CiResult> = {}): CiResult {
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
    plan: {
      jobs: ['plan', 'fast', 'check'],
      skips: {},
      shards: [],
      outputs: { ...EMPTY_OUTPUTS, selected_static: 'static:migration-order' },
    },
    ...overrides,
  };
}

function writePlan(root: string, directory: string, overrides: Partial<CiResult> = {}): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, resultFileName('plan', null)), JSON.stringify(planOf(root, overrides)));
}

const ledgerOf = (path: string): CiResult[] => {
  const receipts = readLedger(path);
  if ('unreadable' in receipts) throw new Error(receipts.unreadable);
  return receipts;
};

test("a CI runner's Plan start in a changed checkout reaches the ledger without a producer, so it withdraws an older pass", () => {
  inFolder((folder) => {
    const ledger = join(folder, 'ledger.jsonl');
    // An empty index makes the checkout differ from its commit. No CI_BASE_SHA: the plan stops
    // after its start receipt.
    runJob(repository, 'plan', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: join(folder, 'run'),
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
      GIT_INDEX_FILE: join(folder, 'empty-index'),
    });
    expect(ledgerOf(ledger)[0]).toMatchObject({
      job: 'plan',
      event: 'integration',
      status: 'running',
      producer: null,
      runUrl: RUN_URL,
    });
  });
});

test("Fast's migration gate sees the plan's base and no ledger or producer, and only job.ts writes the receipts", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    const ledger = join(folder, 'ledger.jsonl');
    writePlan(root, run);
    const code = runJob(root, 'fast', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
      ENV_DUMP_DIR: dumps,
    });
    expect(code).toBe(0);
    const seen = (name: string): Record<string, string> =>
      JSON.parse(readFileSync(join(dumps, `${name}.json`), 'utf8'));
    expect(seen('static:migration-order')).toMatchObject({ CI: 'true', CI_BASE_SHA: 'd'.repeat(40) });
    expect(seen('static:migration-order')).not.toHaveProperty('GITHUB_ACTIONS');
    for (const child of ['static:migration-order', 'env-local', 'build']) {
      expect(seen(child)).not.toHaveProperty('CI_LEDGER');
      expect(seen(child)).not.toHaveProperty('CI_PRODUCER');
    }
    expect(ledgerOf(ledger).map(({ job, status, producer }) => ({ job, status, producer }))).toEqual([
      { job: 'fast', status: 'running', producer: 'mac-standin' },
      { job: 'fast', status: 'passed', producer: 'mac-standin' },
    ]);
  });
});

test('a job whose checkout changed while it ran, by an edit or a new commit, fails, and its receipt has no producer', () => {
  inFolder((folder) => {
    for (const change of ['edit', 'commit']) {
      const root = fixture(join(folder, change));
      const run = join(folder, change, 'run');
      const dumps = join(folder, change, 'dumps');
      mkdirSync(dumps);
      const ledger = join(folder, change, 'ledger.jsonl');
      writePlan(root, run);
      const code = runJob(root, 'fast', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_LEDGER: ledger,
        CI_RUN_URL: RUN_URL,
        ENV_DUMP_DIR: dumps,
        CHANGE_CHECKOUT: change,
      });
      const fast = readResult(join(run, resultFileName('fast', null)));
      expect([change, code, fast]).toMatchObject([change, 1, { status: 'failed', producer: null }]);
      expect(ledgerOf(ledger).at(-1)).toMatchObject({ job: 'fast', status: 'failed', producer: null });
    }
  });
});

test('a job whose commit moves right after it reads its tree fails, and its receipt names one commit and its tree', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    // A git on PATH that commits once, right after the job's first read of a tree.
    const bin = join(folder, 'bin');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(
      join(bin, 'git'),
      `#!/bin/sh
"${realGit}" "$@"
code=$?
case "$*" in
  *rev-parse*'^{tree}'*)
    if [ ! -e "${join(folder, 'moved')}" ]; then
      touch "${join(folder, 'moved')}"
      echo '// moved' >> scripts/ci-plan.ts
      "${realGit}" -c user.name=ci -c user.email=ci@example.invalid commit --quiet --all --message moved
    fi
    ;;
esac
exit $code
`,
      { mode: 0o755 },
    );
    writePlan(root, run);
    const code = runJob(root, 'fast', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
      ENV_DUMP_DIR: dumps,
      PATH: `${bin}:${process.env.PATH}`,
    });
    const fast = readResult(join(run, resultFileName('fast', null)));
    if ('unreadable' in fast) throw new Error(fast.unreadable);
    expect(git(root, 'rev-parse', `${fast.commit}^{tree}`)).toBe(fast.tree);
    expect([code, fast.status, fast.producer]).toEqual([1, 'failed', null]);
  });
});

test('a job refuses a stale same-tree plan of another run, event or a plan without a producer, and fails', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    for (const [name, overrides] of [
      ['another run', { runUrl: 'https://ci.example/runs/1' }],
      ['another event', { event: 'pr' }],
      ['no producer', { producer: null }],
      ['incomplete', { completedAt: null }],
    ] as const) {
      const run = join(folder, name);
      writePlan(root, run, overrides);
      const code = runJob(root, 'fast', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_RUN_URL: RUN_URL,
        ENV_DUMP_DIR: dumps,
      });
      const fast = readResult(join(run, resultFileName('fast', null)));
      expect([name, code, 'status' in fast && fast.status]).toEqual([name, 1, 'failed']);
    }
    // No gate ran by a refused plan.
    expect(spawnSync('ls', [dumps], { encoding: 'utf8' }).stdout).toBe('');
  });
});

test("a push reuses the tree an integration run passed: Plan's own start, appended before it reads, does not withdraw it", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const ledger = join(folder, 'ledger.jsonl');
    const integration = 'https://ci.example/runs/1';
    const start = planOf(root, {
      runUrl: integration,
      status: 'running',
      completedAt: null,
      plan: undefined,
    });
    const check = { ...start, job: 'check', status: 'passed', completedAt: '2026-11-20T20:30:00.000Z' };
    writeFileSync(ledger, `${JSON.stringify(start)}\n${JSON.stringify(check)}\n`);
    const code = runJob(root, 'plan', {
      CI_EVENT: 'main',
      CI_BASE_SHA: 'HEAD',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
    });
    expect(code).toBe(0);
    const plan = readResult(join(run, resultFileName('plan', null)));
    expect(plan).toMatchObject({ status: 'passed', reusedFrom: integration });
    expect('plan' in plan && plan.plan?.jobs).toEqual(['plan', 'check']);
    expect(ledgerOf(ledger).map(({ job, status, runUrl }) => ({ job, status, runUrl }))).toEqual([
      { job: 'plan', status: 'running', runUrl: integration },
      { job: 'check', status: 'passed', runUrl: integration },
      { job: 'plan', status: 'running', runUrl: RUN_URL },
      { job: 'plan', status: 'passed', runUrl: RUN_URL },
    ]);
  });
});

test('a ledger that rejects appends and reads leaves Plan passed, with the full work of its event and no reuse', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    // A directory refuses both the append and the read.
    const ledger = join(folder, 'ledger.jsonl');
    mkdirSync(ledger);
    const code = runJob(root, 'plan', {
      CI_EVENT: 'integration',
      CI_BASE_SHA: 'HEAD',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
    });
    expect(code).toBe(0);
    const plan = readResult(join(run, resultFileName('plan', null)));
    expect(plan).toMatchObject({ status: 'passed', reusedFrom: null });
    expect('plan' in plan && plan.plan?.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'check']);
  });
});

test("off GitHub, Check fails without a scheduler report when this run's Plan is missing, or failed beside an earlier attempt's passed plan", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const variables = { CI_EVENT: 'integration', CI_PRODUCER: 'mac-standin', CI_RUN_URL: RUN_URL };
    const missing = join(folder, 'missing');
    mkdirSync(missing);
    expect(runJob(root, 'check', { ...variables, CI_RESULTS_DIR: missing })).toBe(1);
    // A rerun of the same run: its Plan fails (no CI_BASE_SHA) over the plan an earlier attempt passed.
    const rerun = join(folder, 'rerun');
    const reason = 'The integration run https://ci.example/runs/1 passed this exact tree.';
    const skips = { fast: reason, sql: reason, components: reason, midnight: reason, browser: reason };
    writePlan(root, rerun, { plan: { jobs: ['plan', 'check'], skips, shards: [], outputs: EMPTY_OUTPUTS } });
    // The earlier attempt's plan alone passes Check, so only the rerun's failed Plan can fail it.
    expect(runJob(root, 'check', { ...variables, CI_RESULTS_DIR: rerun })).toBe(0);
    expect(runJob(root, 'plan', { ...variables, CI_RESULTS_DIR: rerun })).toBe(1);
    expect(readResult(join(rerun, resultFileName('plan', null)))).toMatchObject({ status: 'failed' });
    expect(runJob(root, 'check', { ...variables, CI_RESULTS_DIR: rerun })).toBe(1);
  });
});
