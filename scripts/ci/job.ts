import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { checkRun, parseScheduler } from '../../lib/testing/ci/check';
import { CI_EVENTS, CI_JOBS, type CiJob } from '../../lib/testing/ci/dag';
import {
  type CiResult,
  readLedger,
  readResult,
  resultFileName,
  type RunPlan,
} from '../../lib/testing/ci/results';
import {
  passedTreeActionsFilter,
  passedTreeActionsQuery,
  passedTreeInLedger,
  reusableReceipt,
} from '../../lib/testing/ci/reuse';
import { isStep, plannedGroups, planRun } from '../../lib/testing/ci/run-plan';
import { workspaceAppOrigin } from '../../lib/testing/runner/app-port';
import { repository, run, step, verify } from './run';

// One CI job's body, the same on GitHub Actions (.github/workflows/ci.yml) and on any other runner
// (docs/technical/testing.md, "CI"). lib/testing/ci/dag.ts holds the jobs, their needs and events.
// Usage: bun scripts/ci/job.ts <plan|fast|sql|components|midnight|browser|check>
// The job exits 0 when it passed. It reads plain environment variables only:
//   CI_EVENT        pr | integration | main | full (lib/testing/ci/dag.ts). Required.
//   CI_RESULTS_DIR  The run's results directory. Required. Each job writes <job>.json there
//                   (browser-<n>.json for a shard); every job after plan reads plan.json, and check
//                   reads them all.
//   CI_BASE_SHA     plan: the commit to diff against: a PR's or queue entry's base, the previous
//                   main commit of a push. Any git revision. Required except for full.
//   CI_FULL_REASON  plan: why every browser group runs. Required for full.
//   CI_SHARD        browser: the shard's number in the plan. Required for browser.
//   CI_PRODUCER     The CI runner's name, recorded in every result. Unset on a workstation, whose
//                   results are never reused.
//   CI_LEDGER       The runner's JSONL ledger of results. plan reads it to reuse a passed result,
//                   and with CI_PRODUCER set every job appends its final result. Optional.
//   CI_RUN_URL      The run's address, which a later reuse cites. Optional.
//   CI_BUILD_TAR    fast packs its build into this file, and a browser shard unpacks it. Optional.
//   CI_NEEDS        check: the scheduler's job results, as ci.yml's `toJSON(needs)`. Optional.
//   SHRINK_ONLY_GROWTH_APPROVED  `true` with the owner's `approved: list growth` label.
//   MIDNIGHT_PROOF_MINUTES       plan: passed on to scripts/ci-plan.ts.
// On GitHub Actions (GITHUB_ACTIONS=true and GH_TOKEN) plan also asks the Actions API for a green
// merge-queue run of the tree, and writes its outputs to $GITHUB_OUTPUT.

const environment = process.env;
const jobName = CI_JOBS.find((name) => name === process.argv[2]);
const eventName = CI_EVENTS.find((name) => name === environment.CI_EVENT);
const directory = environment.CI_RESULTS_DIR;
if (!jobName || !eventName || !directory)
  throw new Error(
    `Usage: CI_EVENT=<${CI_EVENTS.join('|')}> CI_RESULTS_DIR=<directory> bun scripts/ci/job.ts <${CI_JOBS.join('|')}>`,
  );
const ci = { job: jobName, event: eventName, directory };
const shard = ci.job === 'browser' ? Number(environment.CI_SHARD) : null;
if (shard !== null && !(Number.isInteger(shard) && shard > 0))
  throw new Error('A browser job needs CI_SHARD, a shard number of the plan.');
mkdirSync(ci.directory, { recursive: true });

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const listGrowthApproved = environment.SHRINK_ONLY_GROWTH_APPROVED === 'true';
const result: CiResult = {
  version: 1,
  job: ci.job,
  shard,
  event: ci.event,
  tree: git('rev-parse', 'HEAD^{tree}'),
  commit: git('rev-parse', 'HEAD'),
  base: environment.CI_BASE_SHA || null,
  status: 'running',
  groups: [],
  planReason: '',
  reusedFrom: null,
  listGrowthApproved,
  producer: environment.CI_PRODUCER || null,
  runUrl: environment.CI_RUN_URL || null,
  startedAt: new Date().toISOString(),
  completedAt: null,
};
const resultPath = join(ci.directory, resultFileName(ci.job, shard));
const writeResult = (): void => writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
writeResult();
const everyGroupPassed = (): boolean =>
  !verifyExitFailed && result.groups.length > 0 && result.groups.every((group) => group.outcome === 'passed');

/** This run's plan; every job after plan runs by it. */
function runPlan(): RunPlan {
  const plan = readResult(join(ci.directory, resultFileName('plan', null)));
  if ('unreadable' in plan) throw new Error(`The plan cannot be read: ${plan.unreadable}`);
  if (plan.status !== 'passed' || !plan.plan || plan.tree !== result.tree)
    throw new Error('The plan did not pass on this tree, so no job runs by it.');
  result.planReason = plan.planReason;
  return plan.plan;
}

/** The outputs of scripts/ci-plan.ts, which writes them to a $GITHUB_OUTPUT file of their own. */
async function plannerOutputs(): Promise<Record<string, string>> {
  const outputFile = join(ci.directory, 'ci-plan.output');
  writeFileSync(outputFile, '');
  const [flag, value] =
    ci.event === 'full' ? ['--full', environment.CI_FULL_REASON] : ['--base', environment.CI_BASE_SHA];
  if (!value)
    throw new Error(ci.event === 'full' ? 'A full run needs CI_FULL_REASON.' : 'The plan needs CI_BASE_SHA.');
  const { code } = await run(process.execPath, ['scripts/ci-plan.ts', flag, value], {
    GITHUB_OUTPUT: outputFile,
  });
  if (code !== 0) throw new Error(`scripts/ci-plan.ts ended with ${code}.`);
  return Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

/** The green merge-queue run of this tree on GitHub Actions, or undefined when there is none or the API cannot say. */
function passedTreeOnActions(): string | undefined {
  const repositoryName = environment.GITHUB_REPOSITORY;
  if (environment.GITHUB_ACTIONS !== 'true' || !repositoryName) return undefined;
  const answer = spawnSync(
    'gh',
    ['api', passedTreeActionsQuery(repositoryName), '--jq', passedTreeActionsFilter(result.tree)],
    { encoding: 'utf8' },
  );
  if (answer.status === 0) return answer.stdout.trim() || undefined;
  console.info(
    "::warning title=Merge queue::The merge queue's runs could not be read, so this push runs its jobs.",
  );
  return undefined;
}

async function plan(): Promise<boolean> {
  const ledger = environment.CI_LEDGER ? readLedger(environment.CI_LEDGER) : [];
  if ('unreadable' in ledger)
    console.info(`::warning title=Ledger::${ledger.unreadable}, so no result is reused.`);
  const receipts = 'unreadable' in ledger ? [] : ledger;
  const passedTree =
    ci.event === 'main' ? (passedTreeInLedger(receipts, result.tree) ?? passedTreeOnActions()) : undefined;
  const planned = planRun({
    event: ci.event,
    tree: result.tree,
    listGrowthApproved,
    outputs: passedTree === undefined ? await plannerOutputs() : undefined,
    passedTree,
    reused: (key) => reusableReceipt(receipts, key, ci.event),
  });
  result.plan = planned;
  result.reusedFrom = passedTree ?? null;
  result.planReason = passedTree
    ? `Reused tree: ${passedTree}`
    : planned.outputs.full_reason
      ? `Every browser group: ${planned.outputs.full_reason}`
      : 'Selection by diff';
  for (const [skipped, reason] of Object.entries(planned.skips))
    console.info(`[ci] ${skipped}: skipped. ${reason}`);
  console.info(`[ci] ${ci.event} run of tree ${result.tree} runs ${planned.jobs.join(', ')}.`);
  const outputs = { ...planned.outputs, jobs: JSON.stringify(planned.jobs), reused: passedTree ?? '' };
  if (environment.GITHUB_OUTPUT)
    appendFileSync(
      environment.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    );
  return true;
}

/** A verify.ts run that exited with a failure, even beside a passed report, fails the job. */
let verifyExitFailed = false;

/** Records outcomes over the planned groups. An outcome the plan did not list fails the job. */
function record(outcomes: readonly CiResult['groups'][number][]): void {
  for (const outcome of outcomes) {
    const index = result.groups.findIndex((group) => group.id === outcome.id);
    if (index === -1) throw new Error(`${outcome.id} ran, but the plan does not hold it.`);
    result.groups[index] = outcome;
  }
}

/** Records a verify.ts run: its groups, and its exit. */
function recordVerify(verified: Awaited<ReturnType<typeof verify>>): void {
  verifyExitFailed ||= !verified.exited;
  record(verified.groups);
}

/** The planned verification groups of this job, without its steps. */
const verificationGroups = (): string[] => result.groups.map((group) => group.id).filter((id) => !isStep(id));

/** The commands of the one production build, which a browser shard serves. */
const buildCommands = [
  // The stack's URL and keys are the CLI's fixed defaults, recorded in .env.local-stack-backup.
  [process.execPath, ['run', 'env:local']],
  // The app reads its one-time-code secret from the environment, as on a shard (local-stack action).
  [
    process.execPath,
    ['run', 'build'],
    { EMAIL_OTP_HASH_SECRET: environment.EMAIL_OTP_HASH_SECRET || randomBytes(32).toString('hex') },
  ],
] as const;

async function fast(): Promise<boolean> {
  // Lint, the static gates and Unit overlap (verify.ts --jobs). The build follows, so the type check
  // and the linter read the checkout without the build's generated types, as they always did.
  recordVerify(await verify(verificationGroups(), ['--jobs', '4']));
  const tar = environment.CI_BUILD_TAR;
  record([
    await step('step:build', [
      ...buildCommands,
      // A tar keeps the symbolic links Next writes under .next/node_modules. The cache stays here.
      ...(tar ? [['tar', ['--create', '--file', tar, '--exclude=.next/cache', '.next']] as const] : []),
    ]),
  ]);
  return everyGroupPassed();
}

async function sql(): Promise<boolean> {
  recordVerify(await verify(verificationGroups(), []));
  // The committed types match every committed migration (docs/technical/environments.md, "The
  // migration rule"), checked after a failed SQL group too. The registry variable stays on this
  // command: the build identity fingerprints every SUPABASE_ variable the test runner sees.
  record([
    await step('step:types', [
      [
        process.execPath,
        ['run', 'types:check', '--', '--local'],
        { SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io' },
      ],
    ]),
  ]);
  // The owner's demo seeder seeds both companies on the stack with every committed migration; the
  // second run starts with the reset (docs/technical/environments.md, "Work on production").
  const seed = [process.execPath, ['scripts/seed-demo-data.ts', '--target', 'local']] as const;
  if (result.groups.every((group) => group.id === 'step:seed' || group.outcome === 'passed'))
    record([await step('step:seed', [seed, seed])]);
  return everyGroupPassed();
}

async function components(): Promise<boolean> {
  recordVerify(await verify(verificationGroups(), []));
  return everyGroupPassed();
}

async function midnight(): Promise<boolean> {
  const until = Date.parse(runPlan().outputs.midnight_until ?? '');
  if (Number.isNaN(until))
    throw new Error('The plan sets no midnight hold, so this job has nothing to wait for.');
  for (let left = until - Date.now(); left > 0; left = until - Date.now()) {
    console.info(`Waiting for the midnight start window: ${Math.ceil(left / 60_000)} min left.`);
    await Bun.sleep(Math.min(left, 60_000));
  }
  return true;
}

/** Serves the recorded build for the whole shard; the server proves it is this checkout's source and environment. */
async function startTestServer(log: string): Promise<{ ready: boolean; stop: () => void }> {
  const output = openSync(log, 'w');
  const server = spawn(process.execPath, ['run', 'test:server', 'local', '--prebuilt'], {
    cwd: repository,
    stdio: ['ignore', output, output],
    detached: true,
  });
  closeSync(output);
  let exited = false;
  server.once('exit', () => (exited = true));
  const stop = (): void => {
    if (!exited && server.pid) process.kill(-server.pid, 'SIGTERM');
  };
  const login = `${workspaceAppOrigin(repository)}/login`;
  for (const deadline = Date.now() + 900_000; !exited && Date.now() < deadline; await Bun.sleep(5_000)) {
    if (!readFileSync(log, 'utf8').includes('Serving the recorded local build')) continue;
    if (
      await fetch(login).then(
        (response) => response.ok,
        () => false,
      )
    )
      return { ready: true, stop };
  }
  console.error(readFileSync(log, 'utf8'));
  return { ready: false, stop };
}

async function browser(): Promise<boolean> {
  const started = Date.now();
  // A shard serves Fast's build when the runner hands it over in the same workspace path, which the
  // build receipt and the site origin bind. Without it, the shard builds in its own checkout.
  const tar = environment.CI_BUILD_TAR;
  const built = tar
    ? (await run('tar', ['--extract', '--file', tar])).code === 0
    : (await step('step:server', buildCommands)).outcome === 'passed';
  mkdirSync(join(repository, '.agent-logs'), { recursive: true });
  // The server's output stays with the failure evidence under .agent-logs/.
  const server = built ? await startTestServer(join(repository, '.agent-logs/test-server.log')) : undefined;
  try {
    record([
      { id: 'step:server', outcome: server?.ready ? 'passed' : 'failed', durationMs: Date.now() - started },
    ]);
    // One worker: the stack, the server and a second browser outran a shared runner's four cores.
    // Untimed: a shared runner's load makes wall clock noise, so a wall-clock group of a full run
    // proves its steps and judges no timing. No other group's verdict changes.
    if (server?.ready) recordVerify(await verify(verificationGroups(), ['--jobs', '1', '--untimed']));
  } finally {
    server?.stop();
  }
  return everyGroupPassed();
}

function check(): boolean {
  const own = new Set([resultFileName('plan', null), resultFileName('check', null)]);
  const plan = readResult(join(ci.directory, resultFileName('plan', null)));
  const verdict = checkRun({
    run: { tree: result.tree, event: ci.event },
    plan,
    results: readdirSync(ci.directory)
      .filter((file) => file.endsWith('.json') && !own.has(file))
      .map((file) => readResult(join(ci.directory, file))),
    scheduler: parseScheduler(environment.CI_NEEDS),
  });
  for (const line of verdict.lines) console.info(line);
  if (!('unreadable' in plan)) {
    result.planReason = plan.planReason;
    result.reusedFrom = plan.reusedFrom;
  }
  return verdict.passed;
}

const bodies: Record<CiJob, () => Promise<boolean> | boolean> = {
  plan,
  fast,
  sql,
  components,
  midnight,
  browser,
  check,
};
const appendToLedger = (): void => {
  if (environment.CI_LEDGER && result.producer)
    appendFileSync(environment.CI_LEDGER, `${JSON.stringify(result)}\n`);
};
let passed = false;
try {
  // A job records its planned key before it runs, in its result and the ledger: an attempt that
  // fails or dies before it reports a group still withdraws an earlier pass of the same key.
  if (ci.job !== 'plan' && ci.job !== 'check') {
    const plan = runPlan();
    const shardGroups = plan.shards.find((entry) => entry.shard === shard)?.groups;
    if (ci.job === 'browser' && shardGroups === undefined)
      throw new Error(`The plan holds no browser shard ${shard}.`);
    result.groups = plannedGroups(ci.job, plan.outputs, shardGroups).map((id) => ({
      id,
      outcome: 'not-run',
      durationMs: 0,
    }));
    writeResult();
    appendToLedger();
  }
  passed = await bodies[ci.job]();
} catch (error) {
  console.error(`::error title=${ci.job}::${error instanceof Error ? error.message : String(error)}`);
}
result.status = passed ? 'passed' : 'failed';
result.completedAt = new Date().toISOString();
writeResult();
appendToLedger();
console.info(`[ci] ${ci.job}${shard === null ? '' : ` ${shard}`}: ${result.status}`);
process.exitCode = passed ? 0 : 1;
