// A job body records what reuse and the gates need from a runner that follows the contract in
// scripts/ci/job.ts: a CI Plan start always reaches the ledger, and every job after Plan takes the
// base the plan recorded. Each case runs the real job.ts on a path that ends before any group runs.
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type CiResult, readLedger, resultFileName } from './results';

const repository = resolve(import.meta.dir, '../../..');

/** Runs `job` of scripts/ci/job.ts with only the variables given, and the path to find bun and git. */
function runJob(job: string, variables: Record<string, string>): void {
  spawnSync(process.execPath, ['scripts/ci/job.ts', job], {
    cwd: repository,
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, ...variables },
    encoding: 'utf8',
  });
}

function inFolder(body: (folder: string) => void): void {
  const folder = mkdtempSync(join(tmpdir(), 'ci-job-'));
  try {
    body(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("a CI runner's Plan start in a changed checkout reaches the ledger without a producer, so it withdraws an older pass", () => {
  inFolder((folder) => {
    const ledger = join(folder, 'ledger.jsonl');
    // An empty index makes the checkout differ from its commit. No CI_BASE_SHA: the plan stops
    // after its start receipt.
    runJob('plan', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: join(folder, 'run'),
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: 'https://ci.example/runs/2',
      GIT_INDEX_FILE: join(folder, 'empty-index'),
    });
    const receipts = readLedger(ledger);
    if ('unreadable' in receipts) throw new Error(receipts.unreadable);
    expect(receipts[0]).toMatchObject({
      job: 'plan',
      event: 'integration',
      status: 'running',
      producer: null,
      runUrl: 'https://ci.example/runs/2',
    });
  });
});

test("a job after Plan takes the plan's base without CI_BASE_SHA, so Fast's migration gate diffs against it", () => {
  inFolder((folder) => {
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();
    const plan: CiResult = {
      version: 1,
      job: 'plan',
      shard: null,
      event: 'integration',
      tree,
      commit: 'c'.repeat(40),
      base: 'd'.repeat(40),
      status: 'passed',
      groups: [],
      planReason: 'Selection by diff',
      reusedFrom: null,
      listGrowthApproved: false,
      producer: null,
      runUrl: null,
      startedAt: '2026-11-20T20:00:00.000Z',
      completedAt: '2026-11-20T20:01:00.000Z',
      // No component group: the job ends before it runs one.
      plan: { jobs: ['plan', 'components', 'check'], skips: {}, shards: [], outputs: { components: '' } },
    };
    writeFileSync(join(folder, resultFileName('plan', null)), JSON.stringify(plan));
    runJob('components', { CI_EVENT: 'integration', CI_RESULTS_DIR: folder });
    const components: unknown = JSON.parse(
      readFileSync(join(folder, resultFileName('components', null)), 'utf8'),
    );
    expect(components).toMatchObject({ job: 'components', base: 'd'.repeat(40) });
  });
});
