// A job body keeps the runner contract of scripts/ci/job.ts: a CI Plan start always reaches the
// ledger, a job runs only by its own run's plan, its gates see the base that plan recorded, and no
// child process can write a receipt. Each case runs the real job.ts.
import { expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_OUTPUTS,
  fixture,
  git,
  inFolder,
  planOf,
  repository,
  RUN_URL,
  runJob,
  writePlan,
} from '../fixtures/ci-job-repository';
import { type CiResult, readLedger, readResult, resultFileName, type RunPlan } from './results';
import { plannedWork } from './run-plan';

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

test('a job records its cost and the runner measurement inputs, and an unreadable input warns without failing it', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const dumps = join(folder, 'dumps');
    mkdirSync(dumps);
    writePlan(root, run);
    const fast = (measurement: Record<string, string>): CiResult => {
      const code = runJob(root, 'fast', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_RUN_URL: RUN_URL,
        ENV_DUMP_DIR: dumps,
        ...measurement,
      });
      const result = readResult(join(run, resultFileName('fast', null)));
      if ('unreadable' in result) throw new Error(result.unreadable);
      expect([measurement, code]).toEqual([measurement, 0]);
      return result;
    };
    const runnerStartedAt = '2026-11-20T19:00:00.000Z';
    const measured = fast({
      CI_PRS: '12',
      CI_RUN_ATTEMPT: '2',
      CI_FIRST_ATTEMPT_CLASS: 'environment',
      CI_JOB_STARTED_AT: runnerStartedAt,
    });
    expect(measured).toMatchObject({ prs: [12], attempt: 2, firstAttemptClass: 'environment' });
    expect(measured.cost).toEqual({
      machineStart: true,
      runnerStartedAt,
      // Fast's build is a gate, not setup: only the runner's time before the body counts.
      setupMs: Date.parse(measured.startedAt) - Date.parse(runnerStartedAt),
      wallMs: Date.parse(measured.completedAt ?? '') - Date.parse(runnerStartedAt),
    });
    // Each unreadable input leaves a readable receipt, so Check and reuse still read it.
    for (const inputs of [
      { CI_PRS: 'twelve', CI_RUN_ATTEMPT: 'x', CI_JOB_STARTED_AT: 'soon' },
      { CI_PRS: '9007199254740992', CI_RUN_ATTEMPT: '9007199254740992' },
    ]) {
      const unknown = fast(inputs);
      expect(unknown).toMatchObject({ status: 'passed', prs: [], attempt: null, firstAttemptClass: null });
      expect(unknown.cost).toMatchObject({ runnerStartedAt: null, setupMs: 0 });
    }
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

/** The fixture planner's outputs, as scripts/ci-plan.ts writes them in `fixture`. */
const FIXTURE_OUTPUTS = {
  ...EMPTY_OUTPUTS,
  static: 'static:migration-order',
  sql: 'sql:grants',
  selected_static: 'static:migration-order',
  selected_sql: 'sql:grants',
  selected_components: 'ui:contracts:work',
  component_shards: '[{"shard":1,"groups":"ui:contracts:work"}]',
};

/** An integration run of the fixture's tree in the ledger: its Plan start, its passed Plan on `base` with `work`, and its passed Check. */
function integrationPass(root: string, ledger: string, base: string, work: readonly string[]): string {
  const integration = 'https://ci.example/runs/1';
  const start = planOf(root, {
    runUrl: integration,
    status: 'running',
    completedAt: null,
    plan: undefined,
    base,
  });
  const planned = planOf(root, {
    runUrl: integration,
    base,
    plan: {
      jobs: ['plan', 'fast', 'sql', 'components', 'check'],
      skips: {},
      shards: [],
      outputs: FIXTURE_OUTPUTS,
      work: [...work],
    },
  });
  const check = {
    ...start,
    job: 'check',
    status: 'passed',
    completedAt: '2026-11-20T20:30:00.000Z',
    planStartedAt: start.startedAt,
  };
  writeFileSync(ledger, [start, planned, check].map((receipt) => `${JSON.stringify(receipt)}\n`).join(''));
  return integration;
}

/** Plan of a push of the fixture's commit with base `base`, against `ledger`. */
function pushPlan(
  root: string,
  run: string,
  ledger: string,
  base: string,
  extra: Record<string, string> = {},
): CiResult | { unreadable: string } {
  const code = runJob(root, 'plan', {
    CI_EVENT: 'main',
    CI_BASE_SHA: base,
    CI_RESULTS_DIR: run,
    CI_PRODUCER: 'mac-standin',
    CI_LEDGER: ledger,
    CI_RUN_URL: RUN_URL,
    ...extra,
  });
  expect(code).toBe(0);
  return readResult(join(run, resultFileName('plan', null)));
}

test("a push reuses the landing an integration run passed: Plan's own start, appended before it reads, does not withdraw it", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const ledger = join(folder, 'ledger.jsonl');
    const head = git(root, 'rev-parse', 'HEAD');
    const integration = integrationPass(root, ledger, head, plannedWork('main', FIXTURE_OUTPUTS));
    // A symbolic base counts by the commit it names.
    const plan = pushPlan(root, run, ledger, 'HEAD');
    expect(plan).toMatchObject({ status: 'passed', reusedFrom: integration });
    expect('plan' in plan && plan.plan?.jobs).toEqual(['plan', 'check']);
    expect(ledgerOf(ledger).map(({ job, status, runUrl }) => ({ job, status, runUrl }))).toEqual([
      { job: 'plan', status: 'running', runUrl: integration },
      { job: 'plan', status: 'passed', runUrl: integration },
      { job: 'check', status: 'passed', runUrl: integration },
      { job: 'plan', status: 'running', runUrl: RUN_URL },
      { job: 'plan', status: 'passed', runUrl: RUN_URL },
    ]);
  });
});

test('a push runs its jobs when another run of its tree starts while its planner runs: Plan reads the ledger after planning', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const ledger = join(folder, 'ledger.jsonl');
    integrationPass(root, ledger, git(root, 'rev-parse', 'HEAD'), plannedWork('main', FIXTURE_OUTPUTS));
    const another = planOf(root, {
      runUrl: 'https://ci.example/runs/3',
      status: 'running',
      completedAt: null,
      plan: undefined,
    });
    const plan = pushPlan(root, join(folder, 'run'), ledger, 'HEAD', {
      PLAN_LEDGER: ledger,
      PLAN_APPENDS: JSON.stringify(another),
    });
    expect(plan).toMatchObject({ status: 'passed', reusedFrom: null });
    // Plan's own start still reached the ledger before the planner ran.
    expect(
      ledgerOf(ledger)
        .slice(3)
        .map(({ runUrl, status }) => `${runUrl} ${status}`),
    ).toEqual([`${RUN_URL} running`, 'https://ci.example/runs/3 running', `${RUN_URL} passed`]);
  });
});

test('Plan records the commit its base names, so the planner, the receipt and reuse agree on one commit', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    expect(runJob(root, 'plan', { CI_EVENT: 'integration', CI_BASE_SHA: 'HEAD', CI_RESULTS_DIR: run })).toBe(
      0,
    );
    expect(readResult(join(run, resultFileName('plan', null)))).toMatchObject({
      status: 'passed',
      base: git(root, 'rev-parse', 'HEAD'),
    });
  });
});

test('a push runs its jobs when the integration pass of its tree diffed against another base or required other work', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const head = git(root, 'rev-parse', 'HEAD');
    const work = plannedWork('main', FIXTURE_OUTPUTS);
    const cases = [
      { base: 'e'.repeat(40), work },
      { base: head, work: work.filter((entry) => !entry.startsWith('sql:')) },
    ];
    for (const [index, { base, work: required }] of cases.entries()) {
      const ledger = join(folder, `ledger-${index}.jsonl`);
      integrationPass(root, ledger, base, required);
      const plan = pushPlan(root, join(folder, `run-${index}`), ledger, 'HEAD');
      expect(plan).toMatchObject({ status: 'passed', reusedFrom: null });
      expect('plan' in plan && plan.plan?.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'check']);
    }
  });
});

/** The planner's outputs as `$GITHUB_OUTPUT` lines, for the fixture's PLAN_OUTPUT. */
const plannerLines = (outputs: Record<string, string>): string =>
  Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');

/**
 * An integration run of the fixture, `https://ci.example/runs/1`, whose attempt 1 planned against
 * `base` (only Fast, unless `plan` says otherwise), and whose planner selects only Fast.
 */
function integrationAttempt(root: string, folder: string, base: string, plan?: RunPlan) {
  const run = join(folder, 'run');
  const dumps = join(folder, 'dumps');
  mkdirSync(dumps);
  const runUrl = 'https://ci.example/runs/1';
  writePlan(root, run, { runUrl, base, ...(plan ? { plan } : {}) });
  return {
    CI_EVENT: 'integration',
    CI_RESULTS_DIR: run,
    CI_PRODUCER: 'mac-standin',
    CI_LEDGER: join(folder, 'ledger.jsonl'),
    CI_RUN_URL: runUrl,
    ENV_DUMP_DIR: dumps,
    PLAN_OUTPUT: plannerLines({
      ...EMPTY_OUTPUTS,
      static: 'static:migration-order',
      selected_static: 'static:migration-order',
    }),
  };
}

test("an attempt that plans again never passes Check on an earlier Plan's result", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    // Two bases of one tree: attempt 1 planned against A, attempt 2 plans against B.
    git(root, 'commit', '--quiet', '--allow-empty', '--message', 'base B');
    const [baseA, baseB] = [git(root, 'rev-parse', 'HEAD~1'), git(root, 'rev-parse', 'HEAD')];
    const integration = integrationAttempt(root, folder, baseA);
    expect(runJob(root, 'fast', { ...integration, CI_RUN_ATTEMPT: '1' })).toBe(0);
    // Attempt 1's Fast result stays in the run's folder. A Check that passed on it would let a push
    // on B reuse the run without anything having run against B.
    const second = { ...integration, CI_RUN_ATTEMPT: '2' };
    expect(runJob(root, 'plan', { ...second, CI_BASE_SHA: baseB })).toBe(0);
    expect(readResult(join(integration.CI_RESULTS_DIR, resultFileName('plan', null)))).toMatchObject({
      base: baseB,
      plan: { jobs: ['plan', 'fast', 'check'] },
    });
    expect(runJob(root, 'check', second)).toBe(1);
  });
});

test("a rerun of the failed jobs keeps its Plan, so Check passes on the first attempt's results", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const head = git(root, 'rev-parse', 'HEAD');
    const integration = integrationAttempt(root, folder, head, {
      jobs: ['plan', 'fast', 'components', 'check'],
      skips: { sql: 'None.', invoices: 'None.', midnight: 'None.', browser: 'None.' },
      shards: [],
      outputs: {
        ...EMPTY_OUTPUTS,
        selected_static: 'static:migration-order',
        selected_components: 'ui:contracts:work',
        component_shards: '[{"shard":1,"groups":"ui:contracts:work"}]',
      },
    });
    expect(runJob(root, 'fast', { ...integration, CI_RUN_ATTEMPT: '1' })).toBe(0);
    // Attempt 1's components shard failed, and attempt 2 reruns only it: Fast's result is attempt
    // 1's, the shard's attempt 2's, both under attempt 1's Plan.
    const second = { ...integration, CI_RUN_ATTEMPT: '2' };
    expect(runJob(root, 'components', { ...second, CI_SHARD: '1' })).toBe(0);
    expect(runJob(root, 'check', second)).toBe(0);
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
    const skips = {
      fast: reason,
      sql: reason,
      components: reason,
      invoices: reason,
      midnight: reason,
      browser: reason,
    };
    writePlan(root, rerun, { plan: { jobs: ['plan', 'check'], skips, shards: [], outputs: EMPTY_OUTPUTS } });
    // The earlier attempt's plan alone passes Check, so only the rerun's failed Plan can fail it.
    expect(runJob(root, 'check', { ...variables, CI_RESULTS_DIR: rerun })).toBe(0);
    // Check names the Plan it verified the run by, so a push reuses the run only by that Plan.
    expect(readResult(join(rerun, resultFileName('check', null)))).toMatchObject({
      planStartedAt: planOf(root).startedAt,
    });
    expect(runJob(root, 'plan', { ...variables, CI_RESULTS_DIR: rerun })).toBe(1);
    expect(readResult(join(rerun, resultFileName('plan', null)))).toMatchObject({ status: 'failed' });
    expect(runJob(root, 'check', { ...variables, CI_RESULTS_DIR: rerun })).toBe(1);
  });
});

test('a pull request run that a newer push superseded ends at once and records nothing; on its current head it plans', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const head = git(root, 'rev-parse', 'HEAD');
    // The repository is its own origin, whose pull request ref first holds a newer commit.
    git(root, 'remote', 'add', 'origin', root);
    git(root, 'commit', '--quiet', '--allow-empty', '--message', 'newer push');
    git(root, 'update-ref', 'refs/pull/1/head', 'HEAD');
    git(root, 'checkout', '--quiet', '--detach', head);
    const ledger = join(folder, 'ledger.jsonl');
    const variables = {
      CI_EVENT: 'pr',
      CI_BASE_SHA: 'HEAD',
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
      CI_PR_HEAD_REF: 'refs/pull/1/head',
    };
    const superseded = join(folder, 'superseded');
    expect(runJob(root, 'plan', { ...variables, CI_RESULTS_DIR: superseded })).toBe(1);
    expect(readResult(join(superseded, resultFileName('plan', null)))).toHaveProperty('unreadable');
    expect(readLedger(ledger)).toEqual([]);
    git(root, 'update-ref', 'refs/pull/1/head', head);
    const current = join(folder, 'current');
    expect(runJob(root, 'plan', { ...variables, CI_RESULTS_DIR: current })).toBe(0);
    expect(readResult(join(current, resultFileName('plan', null)))).toMatchObject({ status: 'passed' });
  });
});

test("Check's start reaches the ledger before its end, so a cancelled Check still counts as started", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const ledger = join(folder, 'ledger.jsonl');
    const reason = 'The integration run https://ci.example/runs/1 passed this exact tree.';
    const skips = {
      fast: reason,
      sql: reason,
      components: reason,
      invoices: reason,
      midnight: reason,
      browser: reason,
    };
    writePlan(root, run, { plan: { jobs: ['plan', 'check'], skips, shards: [], outputs: EMPTY_OUTPUTS } });
    const code = runJob(root, 'check', {
      CI_EVENT: 'integration',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_LEDGER: ledger,
      CI_RUN_URL: RUN_URL,
    });
    expect(code).toBe(0);
    expect(ledgerOf(ledger).map(({ job, status }) => ({ job, status }))).toEqual([
      { job: 'check', status: 'running' },
      { job: 'check', status: 'passed' },
    ]);
  });
});

test("a full run's Check records the failed groups no landed plan selected, and only from a runner's ledger", () => {
  inFolder((folder) => {
    const root = fixture(folder);
    const run = join(folder, 'run');
    const ledger = join(folder, 'ledger.jsonl');
    // main's push of this tree selected sql:grants; the full run fails it and sql:missed.
    const landed = planOf(root, {
      event: 'main',
      runUrl: 'https://ci.example/runs/1',
      plan: {
        jobs: ['plan', 'sql', 'check'],
        skips: {},
        shards: [],
        outputs: { ...EMPTY_OUTPUTS, selected_sql: 'sql:grants' },
      },
    });
    writeFileSync(ledger, `${JSON.stringify(landed)}\n`);
    const outputs = { ...EMPTY_OUTPUTS, selected_sql: 'sql:grants,sql:missed' };
    writePlan(root, run, {
      event: 'full',
      plan: { jobs: ['plan', 'sql', 'check'], skips: {}, shards: [], outputs },
    });
    const failed = (id: string) => ({ id, outcome: 'failed' as const, durationMs: 1 });
    writeFileSync(
      join(run, resultFileName('sql', null)),
      JSON.stringify(
        planOf(root, {
          job: 'sql',
          event: 'full',
          status: 'failed',
          plan: undefined,
          groups: [failed('sql:grants'), failed('sql:missed')],
        }),
      ),
    );
    const variables = {
      CI_EVENT: 'full',
      CI_RESULTS_DIR: run,
      CI_PRODUCER: 'mac-standin',
      CI_RUN_URL: RUN_URL,
    };
    expect(runJob(root, 'check', { ...variables, CI_LEDGER: ledger })).toBe(1);
    expect(readResult(join(run, resultFileName('check', null)))).toMatchObject({
      unselectedFailures: ['sql:missed'],
    });
    // Without a ledger no plan of the landed trees is known, so the count stays unknown.
    expect(runJob(root, 'check', variables)).toBe(1);
    expect(readResult(join(run, resultFileName('check', null)))).not.toHaveProperty('unselectedFailures');
    // A result Check cannot read may hold failures, so the count stays unknown too, never a known zero.
    writeFileSync(join(run, resultFileName('sql', null)), '{');
    expect(runJob(root, 'check', { ...variables, CI_LEDGER: ledger })).toBe(1);
    expect(readResult(join(run, resultFileName('check', null)))).not.toHaveProperty('unselectedFailures');
  });
});

test('off GitHub Actions the midnight job never sleeps: started before its hold ends it fails at once, after it passes', () => {
  inFolder((folder) => {
    const root = fixture(folder);
    for (const [name, until, passes] of [
      ['early', '2100-01-01T00:10:00.000Z', false],
      ['due', '2000-01-01T23:10:00.000Z', true],
    ] as const) {
      const run = join(folder, name);
      writePlan(root, run, {
        plan: {
          jobs: ['plan', 'fast', 'midnight', 'browser', 'check'],
          skips: {},
          shards: [{ shard: 1, groups: 'golden:p1-24a' }],
          outputs: { ...EMPTY_OUTPUTS, midnight_until: until },
        },
      });
      // A job that slept for its hold would outlast the test's timeout.
      const code = runJob(root, 'midnight', {
        CI_EVENT: 'integration',
        CI_RESULTS_DIR: run,
        CI_PRODUCER: 'mac-standin',
        CI_RUN_URL: RUN_URL,
        GITHUB_ACTIONS: '',
      });
      const midnight = readResult(join(run, resultFileName('midnight', null)));
      expect([name, code, 'status' in midnight && midnight.status]).toEqual([
        name,
        passes ? 0 : 1,
        passes ? 'passed' : 'failed',
      ]);
    }
  });
});
