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
import { type CiRun, checkRun, parseScheduler, runPlanOf } from '../../lib/testing/ci/check';
import { CI_EVENTS, CI_JOBS, type CiJob } from '../../lib/testing/ci/dag';
import {
  type CiResult,
  type Ledger,
  readLedger,
  readResult,
  resultFileName,
  type RunPlan,
} from '../../lib/testing/ci/results';
import {
  ledgerAfterStart,
  passedTree,
  passedTreeActionsFilter,
  passedTreeActionsQuery,
  reusableReceipt,
} from '../../lib/testing/ci/reuse';
import { isStep, jobShards, midnightNotice, plannedGroups, planRun } from '../../lib/testing/ci/run-plan';
import { workspaceAppOrigin } from '../../lib/testing/runner/app-port';
import { repository, run, step, verify } from './run';

// One CI job's body, the same on GitHub Actions (.github/workflows/ci.yml) and on any other runner
// (docs/technical/testing.md, "CI"). lib/testing/ci/dag.ts holds the jobs, their needs and events.
// Usage: bun scripts/ci/job.ts <plan|fast|sql|components|midnight|browser|check>
// The job exits 0 when it passed. It reads plain environment variables only:
//   CI_EVENT        pr | integration | main | full (lib/testing/ci/dag.ts). Required.
//   CI_RESULTS_DIR  The run's results directory. Required. Each job writes <job>.json there
//                   (<job>-<n>.json for a shard); every job after plan reads plan.json, and check
//                   reads them all.
//   CI_BASE_SHA     plan: the commit to diff against: a PR's or queue entry's base, the previous
//                   main commit of a push. Any git revision. Required except for full. Every later
//                   job takes the base its plan recorded.
//   CI_FULL_REASON  plan: why every browser group runs. Required for full.
//   CI_SHARD        browser, components: the shard's number in the plan (plan.json .plan.shards for
//                   browser, .plan.outputs.component_shards for components). Required for both.
//   CI_PRODUCER     The CI runner's name, recorded in every result. Unset on a workstation, whose
//                   results are never reused. A checkout that differs from its commit records none,
//                   and a job whose checkout changes while it runs fails and records none.
//   CI_LEDGER       The runner's JSONL ledger of results. plan appends its start, then reads it to
//                   reuse a passed result, and with CI_PRODUCER set every job appends its
//                   receipts, a changed checkout's included. When plan cannot append or read it,
//                   plan warns and plans the full work of its event. Optional. Set it only when
//                   the file lives outside every job's checkout and the job's processes cannot
//                   write it (another user, or outside the job's container); without that
//                   guarantee leave it unset, and every run executes in full.
//   No child process sees CI_LEDGER or CI_PRODUCER: only this script appends a receipt, after its
//   child exited. That hides the ledger's name only; the file's permissions keep code under test
//   from forging a receipt.
//   CI_RUN_URL      The run's identity and address: check takes only results of this run, and a
//                   later reuse cites it. The same for every job and rerun of one run. Required
//                   with CI_LEDGER.
//   CI_BUILD_TAR    fast packs its build into this file, and a browser shard unpacks it. Optional.
//   CI_NEEDS        check: the scheduler's job results, as ci.yml's `toJSON(needs)`. Optional.
//   SHRINK_ONLY_GROWTH_APPROVED  `true` with the owner's `approved: list growth` label.
//   MIDNIGHT_PROOF_MINUTES       plan: passed on to scripts/ci-plan.ts; names the wait a proof run.
// On GitHub Actions (GITHUB_ACTIONS=true and GH_TOKEN) without CI_LEDGER, plan asks the Actions API
// for a green merge-queue run of the tree; a configured ledger is the only reuse source. plan writes
// its outputs to $GITHUB_OUTPUT.

const environment = process.env;
// Read once, then removed from the environment every child inherits (run.ts, the test server, git).
const ledgerPath = environment.CI_LEDGER;
const producer = environment.CI_PRODUCER || null;
delete environment.CI_LEDGER;
delete environment.CI_PRODUCER;
const jobName = CI_JOBS.find((name) => name === process.argv[2]);
const eventName = CI_EVENTS.find((name) => name === environment.CI_EVENT);
const directory = environment.CI_RESULTS_DIR;
if (!jobName || !eventName || !directory)
  throw new Error(
    `Usage: CI_EVENT=<${CI_EVENTS.join('|')}> CI_RESULTS_DIR=<directory> bun scripts/ci/job.ts <${CI_JOBS.join('|')}>`,
  );
const ci = { job: jobName, event: eventName, directory };
// Browser and component jobs run once per shard of the plan (jobShards in lib/testing/ci/run-plan.ts).
const shard = ci.job === 'browser' || ci.job === 'components' ? Number(environment.CI_SHARD) : null;
if (shard !== null && !(Number.isInteger(shard) && shard > 0))
  throw new Error(`A ${ci.job} job needs CI_SHARD, a shard number of the plan.`);
mkdirSync(ci.directory, { recursive: true });

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const listGrowthApproved = environment.SHRINK_ONLY_GROWTH_APPROVED === 'true';
// A result proves the commit's tree only when the checkout holds exactly that tree.
const clean = git('status', '--porcelain') === '';
if (!clean)
  console.info(
    '::warning title=Checkout::The checkout differs from its commit, so no result is reused or recorded for reuse.',
  );
if (ledgerPath && !environment.CI_RUN_URL) throw new Error('A run with CI_LEDGER needs CI_RUN_URL.');
// One one-time-code secret for the job's build and its test server, unless the runner gives one.
const otpSecret = environment.EMAIL_OTP_HASH_SECRET || randomBytes(32).toString('hex');
// The commit is read once and the tree from it, so a moving HEAD cannot pair one commit's plan with
// another's test; the final check compares HEAD with this commit.
const commit = git('rev-parse', 'HEAD');
const result: CiResult = {
  version: 1,
  job: ci.job,
  shard,
  event: ci.event,
  tree: git('rev-parse', `${commit}^{tree}`),
  commit,
  base: environment.CI_BASE_SHA || null,
  status: 'running',
  groups: [],
  planReason: '',
  reusedFrom: null,
  listGrowthApproved,
  producer: clean ? producer : null,
  runUrl: environment.CI_RUN_URL || null,
  startedAt: new Date().toISOString(),
  completedAt: null,
};
/** The run this job belongs to; it takes only this run's plan. */
const ownRun: CiRun = { tree: result.tree, event: ci.event, runUrl: result.runUrl, producer };
const resultPath = join(ci.directory, resultFileName(ci.job, shard));
const writeResult = (): void => writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
writeResult();
const everyGroupPassed = (): boolean =>
  !verifyExitFailed && result.groups.length > 0 && result.groups.every((group) => group.outcome === 'passed');

/** This run's plan; every job after plan runs by it, and by no other run's plan of the tree. */
function runPlan(): RunPlan {
  const own = runPlanOf(ownRun, readResult(join(ci.directory, resultFileName('plan', null))));
  if ('problem' in own) throw new Error(`No job runs by this plan: ${own.problem}.`);
  result.planReason = own.result.planReason;
  // Every job diffs against the base its plan recorded, so only plan needs CI_BASE_SHA from the
  // runner. The children read it there: Fast's migration-order gate off GitHub Actions.
  if (own.result.base) environment.CI_BASE_SHA = own.result.base;
  result.base = own.result.base;
  return own.plan;
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

// A CI runner appends every receipt. One from a changed checkout has no producer, so it is never
// reused, but it still withdraws an older pass of its key or tree.
const appendToLedger = (): void => {
  if (ledgerPath && producer) appendFileSync(ledgerPath, `${JSON.stringify(result)}\n`);
};

/**
 * The ledger Plan decides by. Plan appends its start before it reads, so a later attempt of the tree
 * that is still planning, died while planning or planned in a changed checkout withdraws an earlier
 * pass, and so does any other run's start appended meanwhile. A changed checkout reads none.
 */
function planLedger(): Ledger {
  if (!ledgerPath || !producer) return [];
  return ledgerAfterStart({ ...result }, appendToLedger, () =>
    clean ? readLedger(ledgerPath) : { unreadable: 'The checkout differs from its commit' },
  );
}

async function plan(): Promise<boolean> {
  // The ledger only saves work: when it fails, Plan plans the full work of its event and reuses nothing.
  const ledger = planLedger();
  if ('unreadable' in ledger)
    console.info(`::warning title=Ledger::${ledger.unreadable}, so no result is reused.`);
  const reusedTree =
    ci.event === 'main' && clean && !('unreadable' in ledger)
      ? passedTree(ledgerPath ? ledger : undefined, result.tree, passedTreeOnActions)
      : undefined;
  const planned = planRun({
    event: ci.event,
    tree: result.tree,
    listGrowthApproved,
    outputs: reusedTree === undefined ? await plannerOutputs() : undefined,
    passedTree: reusedTree,
    reused: (key) => reusableReceipt(ledger, key, ci.event),
  });
  result.plan = planned;
  result.reusedFrom = reusedTree ?? null;
  result.planReason = reusedTree
    ? `Reused tree: ${reusedTree}`
    : planned.outputs.full_reason
      ? `Every browser group: ${planned.outputs.full_reason}`
      : 'Selection by diff';
  for (const [skipped, reason] of Object.entries(planned.skips))
    console.info(`[ci] ${skipped}: skipped. ${reason}`);
  console.info(`[ci] ${ci.event} run of tree ${result.tree} runs ${planned.jobs.join(', ')}.`);
  // From the final plan: no notice when reuse left no browser shard to wait.
  const notice = midnightNotice(planned, Boolean(environment.MIDNIGHT_PROOF_MINUTES));
  if (notice) {
    console.info(`::notice title=Midnight wait::${notice}`);
    // Plan ends before the wait starts, so its summary is on the run page during the wait.
    if (environment.GITHUB_STEP_SUMMARY) appendFileSync(environment.GITHUB_STEP_SUMMARY, `${notice}\n`);
  }
  const outputs = { ...planned.outputs, jobs: JSON.stringify(planned.jobs), reused: reusedTree ?? '' };
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
  [process.execPath, ['run', 'build'], { EMAIL_OTP_HASH_SECRET: otpSecret }],
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
    env: { ...environment, CI: 'true', EMAIL_OTP_HASH_SECRET: otpSecret },
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
  // A CI Check certifies the tree only from a checkout that holds exactly its commit.
  if (producer && !clean) throw new Error('Check ran on a checkout that differs from its commit.');
  const own = new Set([resultFileName('plan', null), resultFileName('check', null)]);
  const plan = readResult(join(ci.directory, resultFileName('plan', null)));
  const verdict = checkRun({
    run: ownRun,
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
/**
 * Why the checkout no longer holds what the job started on, or undefined: the commit moved, or a
 * checkout that started clean changed. A result proves only the tree it tested.
 */
function checkoutChange(): string | undefined {
  try {
    if (git('rev-parse', 'HEAD') !== result.commit) return 'The checkout moved to another commit';
    if (clean && git('status', '--porcelain') !== '') return 'The checkout changed';
    return undefined;
  } catch (error) {
    return `The checkout could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

let passed = false;
try {
  // A job records its planned key before it runs, in its result and the ledger: an attempt that
  // fails or dies before it reports a group still withdraws an earlier pass of the same key.
  if (ci.job !== 'plan' && ci.job !== 'check') {
    const plan = runPlan();
    const shards = jobShards(ci.job, plan);
    const shardGroups = shards?.find((entry) => entry.shard === shard)?.groups;
    if (shards && shardGroups === undefined) throw new Error(`The plan holds no ${ci.job} shard ${shard}.`);
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
// Before a result is published, the checkout must still hold the tree it names. If not, the job
// fails and its receipt has no producer, so it is never reused but still withdraws an older pass.
const changed = checkoutChange();
if (changed) {
  console.error(`::error title=Checkout::${changed} while the job ran, so its result proves nothing.`);
  passed = false;
  result.producer = null;
}
result.status = passed ? 'passed' : 'failed';
result.completedAt = new Date().toISOString();
writeResult();
try {
  appendToLedger();
} catch (error) {
  // Plan's end decides no reuse, so a ledger that rejects it never fails the run.
  if (ci.job !== 'plan') throw error;
  console.info(
    `::warning title=Ledger::Plan's end could not be appended: ${error instanceof Error ? error.message : String(error)}`,
  );
}
console.info(`[ci] ${ci.job}${shard === null ? '' : ` ${shard}`}: ${result.status}`);
process.exitCode = passed ? 0 : 1;
