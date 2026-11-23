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
import {
  fullRunsInLedger,
  landedSelections,
  MAIN_HISTORY_DEPTH,
  treesSinceFullRun,
  unselectedFailures,
} from '../../lib/testing/ci/full-run';
import { jobCost, measurementInputs } from '../../lib/testing/ci/measurement';
import { CI_EVENTS, CI_JOBS, type CiJob, partGroups, partOf } from '../../lib/testing/ci/dag';
import { parseMirrorMessage } from '../../lib/testing/ci/mirror-message';
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
import {
  isStep,
  jobShards,
  midnightNotice,
  plannedGroups,
  plannedWork,
  planRun,
} from '../../lib/testing/ci/run-plan';
import { lsRemoteCommit, supersedingHead } from '../../lib/testing/ci/superseded';
import { workspaceAppOrigin, workspacePorts } from '../../lib/testing/runner/app-port';
import { guardTestServer } from '../../lib/testing/ci/test-server-stop';
import { E_INVOICE_CHECK, E_INVOICE_STEP } from '../../lib/testing/selection/e-invoice-selection';
import { repository, run, step, verify } from './run';

// One CI job's body, the same on GitHub Actions (.github/workflows/ci.yml) and on any other runner
// (docs/technical/testing.md, "CI"). lib/testing/ci/dag.ts holds the jobs, their needs and events.
// Usage: bun scripts/ci/job.ts <plan|fast|sql|components|invoices|midnight|browser|check>
// `midnight` waits for the plan's hold only on GitHub Actions. Any other runner starts it when
// `bun scripts/ci/schedule.ts due` names its run, and a start before the hold ends fails.
// The job exits 0 when it passed. It reads plain environment variables only:
//   CI_EVENT        pr | integration | main | full (lib/testing/ci/dag.ts). Required.
//   CI_RESULTS_DIR  The run's results directory. Required. Each job writes <job>.json there
//                   (<job>-<n>.json for a shard); every job after plan reads plan.json, and check
//                   reads them all.
//   CI_BASE_SHA     plan: the commit to diff against: a PR's or queue entry's base, the previous
//                   main commit of a push. Any git revision; plan records the commit it names.
//                   Required except for full. Every later job takes the base its plan recorded. A push reuses an integration pass of its
//                   tree only on the commit that pass diffed against, so after a queue landing pass
//                   the tick's `base`, main before the batch: every landed PR's diff, as tested.
//   CI_FULL_REASON  plan: why every browser group runs. Required for full.
//   CI_SHARD        browser, components: the shard's number in the plan (plan.json .plan.shards for
//                   browser, .plan.outputs.component_shards for components). Required for both.
//   CI_PRODUCER     The CI runner's name, recorded in every result. Unset on a workstation, whose
//                   results are never reused. A checkout that differs from its commit records none,
//                   and a job whose checkout changes while it runs fails and records none.
//   CI_LEDGER       The runner's JSONL ledger of results. plan appends its start, then reads it to
//                   reuse a passed result, and with CI_PRODUCER set every job appends its
//                   receipts, a changed checkout's included. check of a full run reads it to
//                   record the groups the run failed that no landed plan selected. When plan
//                   cannot append or read it, plan warns and plans the full work of its event.
//                   Optional. Set it only when the file lives outside every job's checkout and
//                   the job's processes cannot write it (another user, or outside the job's
//                   container); without that guarantee leave it unset, and every run executes in
//                   full.
//   No child process sees CI_LEDGER or CI_PRODUCER: only this script appends a receipt, after its
//   child exited. That hides the ledger's name only; the file's permissions keep code under test
//   from forging a receipt.
//   CI_RUN_URL      The run's identity and address: check takes only results of this run, and a
//                   later reuse cites it. The same for every job and rerun of one run. Required
//                   with CI_LEDGER.
//   CI_BUILD_TAR    fast packs its build into this file, and a browser shard unpacks it. Optional.
//   CI_NEEDS        check: the scheduler's job results, as ci.yml's `toJSON(needs)`. Optional.
//   CI_PR_HEAD_REF  pr: the ref on `origin` that holds the pull request's current head, such as
//                   refs/pull/568/head. When a newer push moved it, every job of the run ends at
//                   once, failed, and writes no result or receipt. Optional.
//   CI_PR_HEAD_SHA  pr: the head commit this run tests, when the checkout is a merge commit on top
//                   of it. Defaults to the checkout's commit.
//   SHRINK_ONLY_GROWTH_APPROVED  `true` with the owner's `approved: list growth` label.
//   CI_PART         The CI mirror's job parts (scripts/ci/mirror-executor.ts, lib/testing/ci/dag.ts).
//                   `tree`: the job runs on the mirror, whose checkout is one parentless commit of
//                   the source's tree with its workflows moved aside; that commit's message names
//                   the source commit and tree, and the result names them. Any other checkout fails.
//                   Fast's tree part runs every group but HOST_GROUPS, the unit group without the
//                   host's files. `host`: Fast only, on the orchestrator's host: HOST_GROUPS and the
//                   unit group's host files, without the build. Unset: the whole job.
//   MIDNIGHT_PROOF_MINUTES       plan: passed on to scripts/ci-plan.ts; names the wait a proof run.
// Measurement inputs (lib/testing/ci/measurement.ts). Optional; no gate reads them, and an unreadable one
// warns and is recorded as unknown, never failing the job. Reuse reads the attempt: an unreadable one
// reuses nothing, and a later attempt's receipt withdraws an earlier attempt's pass:
//   CI_PRS          The pull requests the run serves: numbers separated by commas (a PR run's one, an
//                   integration batch's, a push's landed PRs when the runner knows them), or GitHub's
//                   merge-queue ref. Unset for a full run.
//   CI_RUN_ATTEMPT  The run's attempt, 1 for the first (also when unset); a rerun counts up.
//   CI_FIRST_ATTEMPT_CLASS  On a rerun: the class the job's failed first attempt was given
//                   (docs/technical/testing.md, "Failures").
//   CI_JOB_STARTED_AT  When the runner began this job, before its checkout and setup, as an ISO time.
//   CI_MACHINE_START  `false` when the job ran on the orchestrator's own host, as scripts/ci/run-commit.ts
//                   runs Plan and Check: it started no machine. Otherwise each CI job is one machine start.
// On GitHub Actions (GITHUB_ACTIONS=true and GH_TOKEN) without CI_LEDGER, plan asks the Actions API
// for a green merge-queue run of the commit; a configured ledger is the only reuse source. plan writes
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
const ci = { job: jobName, event: eventName, directory, part: partOf(environment.CI_PART, jobName) };
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
const measured = measurementInputs(environment);
for (const warning of measured.warnings)
  console.info(`::warning title=Measurement::${warning}, so the result records it as unknown.`);
/** One machine start per job process on a CI runner, whatever its checkout holds, unless it ran on the orchestrator's host. */
const machineStart = producer !== null && measured.machineStart;
// One one-time-code secret for the job's build and its test server, unless the runner gives one.
const otpSecret = environment.EMAIL_OTP_HASH_SECRET || randomBytes(32).toString('hex');
// The commit is read once and the tree from it, so a moving HEAD cannot pair one commit's plan with
// another's test; the final check compares HEAD with this commit.
const checkoutCommit = git('rev-parse', 'HEAD');
// On the CI mirror the checkout is the source's tree transformed, which the orchestrator checked
// after the push: a parentless commit whose message names the source, which the result names.
const source = ci.part === 'tree' ? mirrorSource() : undefined;
const commit = source?.commit ?? checkoutCommit;

/** The source commit and tree the mirror's checkout stands for; any other checkout throws. */
function mirrorSource(): { commit: string; tree: string } {
  const run = parseMirrorMessage(git('log', '-1', '--format=%B', checkoutCommit));
  if ('problem' in run) throw new Error(`CI_PART=tree runs only a CI mirror commit: ${run.problem}.`);
  // The commit's own headers: a shallow checkout hides a parent from rev-list.
  if (
    git('cat-file', 'commit', checkoutCommit)
      .split('\n\n')[0]
      ?.split('\n')
      .some((line) => line.startsWith('parent '))
  )
    throw new Error('CI_PART=tree runs only a parentless CI mirror commit.');
  if (run.job !== ci.job || run.shard !== shard)
    throw new Error(`This mirror commit runs ${run.job} ${run.shard ?? ''}, not this job.`);
  return run.source;
}
// A superseded pull request run proves nothing for its PR: it ends before it records anything, so
// it neither costs a runner more time nor withdraws a pass from the ledger.
const newerHead = supersedingHead({
  event: ci.event,
  headRef: environment.CI_PR_HEAD_REF,
  testedHead: environment.CI_PR_HEAD_SHA || commit,
  remoteHead: (ref) => {
    // An unanswered question runs the job: no credential prompt, and at most a minute.
    const answer = spawnSync('git', ['ls-remote', 'origin', ref], {
      cwd: repository,
      encoding: 'utf8',
      env: { ...environment, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return answer.status === 0 ? lsRemoteCommit(answer.stdout, ref) : undefined;
  },
});
if (newerHead) {
  console.error(
    `::error title=Superseded::The pull request moved on to ${newerHead}, so this run of ${environment.CI_PR_HEAD_SHA || commit} stops.`,
  );
  process.exit(1);
}
// Plan records its base as the commit it names, once, so the planner diffs against the commit its
// receipt records and reuse compares; a revision git cannot resolve stays as given, and the planner fails on it.
if (ci.job === 'plan' && environment.CI_BASE_SHA)
  environment.CI_BASE_SHA = commitOf(environment.CI_BASE_SHA) ?? environment.CI_BASE_SHA;
const result: CiResult = {
  version: 1,
  job: ci.job,
  shard,
  event: ci.event,
  tree: source?.tree ?? git('rev-parse', `${checkoutCommit}^{tree}`),
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
  prs: measured.prs,
  attempt: measured.attempt,
  firstAttemptClass: measured.firstAttemptClass,
};
const measureCost = (): void => {
  result.cost = jobCost(result, {
    machineStart,
    runnerStartedAt: measured.runnerStartedAt,
    completedAt: result.completedAt,
  });
};
measureCost();
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
  // Check passes this result only under the Plan it names (lib/testing/ci/check.ts).
  result.planIdentity = own.identity;
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

/** The green merge-queue run of this exact commit on GitHub Actions, or undefined when there is none or the API cannot say. */
function passedTreeOnActions(): string | undefined {
  const repositoryName = environment.GITHUB_REPOSITORY;
  if (environment.GITHUB_ACTIONS !== 'true' || !repositoryName) return undefined;
  const answer = spawnSync(
    'gh',
    ['api', passedTreeActionsQuery(repositoryName), '--jq', passedTreeActionsFilter(result.commit)],
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
 * The ledger Plan decides by. Plan appends its start before the planner runs and reads after it, so
 * a later attempt of the tree that is still planning, died while planning or planned in a changed
 * checkout withdraws an earlier pass, and so does any other run's start appended meanwhile. A
 * changed checkout reads none. `plan` runs between the append and the read.
 */
async function planLedger<T>(plan: () => Promise<T>): Promise<{ ledger: Ledger; planned: T }> {
  if (!ledgerPath || !producer) return { ledger: [], planned: await plan() };
  const start = { ...result };
  let appended: Error | null = null;
  try {
    appendToLedger();
  } catch (error) {
    appended = error instanceof Error ? error : new Error(String(error));
  }
  const planned = await plan();
  const ledger = ledgerAfterStart(
    start,
    () => {
      if (appended !== null) throw appended;
    },
    () => (clean ? readLedger(ledgerPath) : { unreadable: 'The checkout differs from its commit' }),
  );
  return { ledger, planned };
}

/** The commit a revision names, or undefined when git cannot resolve it. */
function commitOf(revision: string | undefined): string | undefined {
  if (!revision) return undefined;
  try {
    return git('rev-parse', '--verify', '--quiet', `${revision}^{commit}`);
  } catch {
    return undefined;
  }
}

async function plan(): Promise<boolean> {
  // The ledger only saves work: when it fails, Plan plans the full work of its event and reuses nothing.
  const { ledger, planned: selection } = await planLedger(plannerOutputs);
  if ('unreadable' in ledger)
    console.info(`::warning title=Ledger::${ledger.unreadable}, so no result is reused.`);
  // A push reuses a passed run only for the same landing: the same tree, base commit and required work.
  const base =
    ci.event === 'main' && clean && !('unreadable' in ledger)
      ? commitOf(result.base ?? undefined)
      : undefined;
  const reusedTree = base
    ? passedTree(
        ledgerPath ? ledger : undefined,
        { tree: result.tree, base, work: plannedWork(ci.event, selection) },
        passedTreeOnActions,
      )
    : undefined;
  const planned = planRun({
    event: ci.event,
    tree: result.tree,
    // Plan resolved CI_BASE_SHA to its commit above; every job of the run records this base.
    base: result.base,
    listGrowthApproved,
    outputs: selection,
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
  if (verificationGroups().length) recordVerify(await verify(verificationGroups(), ['--jobs', '4']));
  // The host part on the CI mirror runs only the groups that read outside the tree, without the build.
  if (!result.groups.some((group) => group.id === 'step:build')) return everyGroupPassed();
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

/**
 * Mustang and veraPDF on the reference invoices; Docker and the network required. The PDFs and
 * Mustang's reports stay under .agent-logs/e-invoices/, one folder per attempt.
 */
async function invoices(): Promise<boolean> {
  const folder = join(repository, '.agent-logs/e-invoices', result.startedAt.replaceAll(':', '-'));
  record([await step(E_INVOICE_STEP, [[process.execPath, [E_INVOICE_CHECK, folder]]])]);
  return everyGroupPassed();
}

async function midnight(): Promise<boolean> {
  const until = Date.parse(runPlan().outputs.midnight_until ?? '');
  if (Number.isNaN(until))
    throw new Error('The plan sets no midnight hold, so this job has nothing to wait for.');
  // Only GitHub Actions cannot start a job later, so only there does a runner wait. Any other runner
  // starts this job when `bun scripts/ci/schedule.ts due` names it, and an early start fails.
  if (environment.GITHUB_ACTIONS !== 'true' && Date.now() < until) {
    console.error(
      `::error title=Midnight wait::This job started before the hold ends at ${new Date(until).toISOString()}. Start it when bun scripts/ci/schedule.ts due names its run; no runner waits for the clock.`,
    );
    return false;
  }
  for (let left = until - Date.now(); left > 0; left = until - Date.now()) {
    console.info(`Waiting for the midnight start window: ${Math.ceil(left / 60_000)} min left.`);
    await Bun.sleep(Math.min(left, 60_000));
  }
  return true;
}

/**
 * Serves the recorded build for the whole shard; the server proves it is this checkout's source and
 * environment. Its stop exists as soon as the server's process does; `ready` reports its start.
 */
function startTestServer(log: string, port: number): { ready: Promise<boolean>; stop: () => Promise<void> } {
  const output = openSync(log, 'w');
  const server = spawn(process.execPath, ['run', 'test:server', 'local', '--prebuilt'], {
    cwd: repository,
    env: { ...environment, CI: 'true', EMAIL_OTP_HASH_SECRET: otpSecret },
    stdio: ['ignore', output, output],
    detached: true,
  });
  closeSync(output);
  let exited = false;
  let failure: Error | undefined;
  server.once('exit', () => (exited = true));
  server.once('error', (error) => {
    failure = error;
    exited = true;
  });
  // The whole group, even after the server itself exited: a runner that reuses this host starts the
  // next job on the same port.
  const { observe, stop } = guardTestServer(server.pid, port);
  const ready = async (): Promise<boolean> => {
    const login = `${workspaceAppOrigin(repository)}/login`;
    for (const deadline = Date.now() + 900_000; !exited && Date.now() < deadline; await Bun.sleep(5_000)) {
      if (!readFileSync(log, 'utf8').includes('Serving the recorded local build')) continue;
      if (
        await fetch(login).then(
          (response) => response.ok,
          () => false,
        )
      ) {
        // The app answers: record its listener's group, which a server that missed its own
        // cancellation would leave holding the port.
        observe();
        return true;
      }
    }
    if (failure)
      console.error(`::error title=Test server::The test server could not start: ${failure.message}`);
    console.error(readFileSync(log, 'utf8'));
    return false;
  };
  return { ready: ready(), stop };
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
  const port = workspacePorts(repository).app;
  const server = built ? startTestServer(join(repository, '.agent-logs/test-server.log'), port) : undefined;
  let stopped = false;
  try {
    const ready = (await server?.ready) ?? false;
    record([{ id: 'step:server', outcome: ready ? 'passed' : 'failed', durationMs: Date.now() - started }]);
    // One worker: the stack, the server and a second browser outran a shared runner's four cores.
    // Untimed: a shared runner's load makes wall clock noise, so a wall-clock group of a full run
    // proves its steps and judges no timing. No other group's verdict changes.
    if (ready) recordVerify(await verify(verificationGroups(), ['--jobs', '1', '--untimed']));
  } finally {
    stopped = await (server?.stop() ?? Promise.resolve()).then(
      () => true,
      (error: unknown) => {
        console.error(`::error title=Test server::${error instanceof Error ? error.message : String(error)}`);
        return false;
      },
    );
  }
  return stopped && everyGroupPassed();
}

/**
 * A full run's failed groups that no plan of the trees landed since the previous full run selected
 * (lib/testing/ci/full-run.ts), or undefined when the runner keeps no ledger, which alone holds
 * those plans, or when a result cannot be read, which may hold failures. A measurement: what it
 * cannot read warns and stays unknown, never failing Check.
 */
function fullRunMisses(results: readonly (CiResult | { unreadable: string })[]): string[] | undefined {
  if (ci.event !== 'full' || !ledgerPath || !producer) return undefined;
  try {
    const unreadable = results.flatMap((entry) => ('unreadable' in entry ? [entry.unreadable] : []));
    if (unreadable.length) throw new Error(unreadable.join('; '));
    const ledger = readLedger(ledgerPath);
    if ('unreadable' in ledger) throw new Error(ledger.unreadable);
    const history = git(
      'log',
      '--first-parent',
      `--max-count=${MAIN_HISTORY_DEPTH}`,
      '--format=%H %T',
      commit,
    )
      .split('\n')
      .flatMap((line) => {
        const [lineCommit, tree] = line.split(' ');
        return lineCommit && tree ? [{ commit: lineCommit, tree }] : [];
      });
    const failed = results.flatMap((entry) =>
      'unreadable' in entry || entry.runUrl !== result.runUrl || entry.tree !== result.tree
        ? []
        : entry.groups.filter((group) => group.outcome === 'failed').map((group) => group.id),
    );
    const landed = treesSinceFullRun(history, fullRunsInLedger(ledger, new Date()));
    return unselectedFailures(failed, landedSelections(ledger, landed));
  } catch (error) {
    console.info(
      `::warning title=Measurement::The full run's unselected failures cannot be counted (${JSON.stringify(error instanceof Error ? error.message : String(error))}), so the result records them as unknown.`,
    );
    return undefined;
  }
}

function check(): boolean {
  // A CI Check certifies the tree only from a checkout that holds exactly its commit.
  if (producer && !clean) throw new Error('Check ran on a checkout that differs from its commit.');
  const own = new Set([resultFileName('plan', null), resultFileName('check', null)]);
  const plan = readResult(join(ci.directory, resultFileName('plan', null)));
  const results = readdirSync(ci.directory)
    .filter((file) => file.endsWith('.json') && !own.has(file))
    .map((file) => readResult(join(ci.directory, file)));
  const verdict = checkRun({ run: ownRun, plan, results, scheduler: parseScheduler(environment.CI_NEEDS) });
  for (const line of verdict.lines) console.info(line);
  if (!('unreadable' in plan)) {
    result.planReason = plan.planReason;
    result.reusedFrom = plan.reusedFrom;
    // A push reuses this run only by the Plan this Check verified it by (lib/testing/ci/reuse.ts).
    result.planStartedAt = plan.startedAt;
  }
  const misses = fullRunMisses(results);
  if (misses) result.unselectedFailures = misses;
  return verdict.passed;
}

const bodies: Record<CiJob, () => Promise<boolean> | boolean> = {
  plan,
  fast,
  sql,
  components,
  invoices,
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
    if (git('rev-parse', 'HEAD') !== checkoutCommit) return 'The checkout moved to another commit';
    if (clean && git('status', '--porcelain') !== '') return 'The checkout changed';
    return undefined;
  } catch (error) {
    return `The checkout could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
}

let passed = false;
try {
  // Check's start reaches the ledger too, so a cancelled Check still counts as started; its end, a
  // passed Check of this run, is still the last receipt that reuses the tree (lib/testing/ci/reuse.ts).
  if (ci.job === 'check') appendToLedger();
  // A job records its planned key before it runs, in its result and the ledger: an attempt that
  // fails or dies before it reports a group still withdraws an earlier pass of the same key.
  if (ci.job !== 'plan' && ci.job !== 'check') {
    const plan = runPlan();
    const shards = jobShards(ci.job, plan);
    const shardGroups = shards?.find((entry) => entry.shard === shard)?.groups;
    if (shards && shardGroups === undefined) throw new Error(`The plan holds no ${ci.job} shard ${shard}.`);
    result.groups = partGroups(plannedGroups(ci.job, plan.outputs, shardGroups), ci.part).map((id) => ({
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
measureCost();
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
