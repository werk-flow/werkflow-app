#!/usr/bin/env bun
// The machine runner of the owner's machines (lib/testing/ci/machine-runner.ts decides; this file
// acts): a user service on the MacBook (launchd) and on the PC (the agents' WSL distribution) that
// claims pull requests and runs their PR runs, every 60 s, until it is stopped.
// Usage: bun scripts/ci/machine-runner.ts --config <machine config file>
// It runs only from the configuration's `trustedCheckout`, a clean clone at a reviewed commit, and
// refuses an image built from another commit. It holds the credentials: its `gh` login reads
// GitHub, files the alerts and clones the private sibling, and the CI App's key (`appKeyFile`) mints
// the token its Check check runs are posted with. Each run is `scripts/ci/run-commit.ts` with the
// container executor (CI_EXECUTOR=container), which keeps every credential out of the job
// containers. Install and operate it as docs/technical/testing.md ("Run CI on the owner's
// machines") says.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CHECK_APP_CONFIG,
  cancelledCheckRunOf,
  checkRunOf,
  finishCheckRun,
  postCheckRun,
  queuedCheckRunOf,
  readCheckApp,
  readHandoff,
  type ScheduledRun,
} from '../../lib/testing/ci/check-app';
import { installationToken } from '../../lib/testing/ci/check-app-token';
import {
  IMAGE_COMMIT_LABEL,
  listCommand,
  otherGenerations,
  stopCommand,
} from '../../lib/testing/ci/container-slot';
import {
  claim,
  heartbeat,
  type LeaseApi,
  type LeaseCheckRun,
  nextGeneration,
  postVerdict,
} from '../../lib/testing/ci/lease';
import {
  type CurrentRun,
  EMPTY_STATE,
  type MachineConfig,
  machineConfigSchema,
  recover,
  type RunLease,
  type RunnerPorts,
  type RunnerState,
  runnerStateSchema,
  TICK_MS,
  tick,
} from '../../lib/testing/ci/machine-runner';
import { PULLS_QUERY, pullsFromGitHub } from '../../lib/testing/ci/queue-github';
import { resultFileName } from '../../lib/testing/ci/results';
import { z } from '../../lib/zod';
import { slotShell } from './container-executor';

const checkRunListSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.number(),
      status: z.string(),
      conclusion: z.string().nullable(),
      app: z.object({ id: z.number() }).nullable(),
      output: z.object({ title: z.string().nullable() }),
    }),
  ),
});
const exitSchema = z.object({ exitCode: z.number().int().nullable() });

const { values } = parseArgs({ options: { config: { type: 'string' } } });
if (!values.config) throw new Error('Usage: bun scripts/ci/machine-runner.ts --config <machine config file>');
const config: MachineConfig = machineConfigSchema.parse(JSON.parse(readFileSync(values.config, 'utf8')));
const trusted = resolve(config.trustedCheckout);
const log = (line: string): void => console.info(`[${new Date().toISOString()}] ${line}`);

/** A command's output, or a throw that names it. */
function run(command: string, args: readonly string[], cwd = trusted): string {
  const answer = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 ** 2 });
  if (answer.status !== 0)
    throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed: ${answer.stderr.trim()}`);
  return answer.stdout.trim();
}

// Trust: this code is the trusted checkout's, at a clean reviewed commit, never a PR's.
if (relative(trusted, resolve(import.meta.dir, '../..')) !== '')
  throw new Error(`The runner runs only from its trusted checkout ${trusted}, not from ${import.meta.dir}.`);
if (run('git', ['status', '--porcelain']) !== '')
  throw new Error(`${trusted} has changes; the runner runs only a clean commit.`);
const trustedCommit = run('git', ['rev-parse', 'HEAD']);
const app = readCheckApp(join(trusted, CHECK_APP_CONFIG));
if ('problem' in app) throw new Error(app.problem);
if (app.appId === null) throw new Error(`${CHECK_APP_CONFIG} names no CI App, so no Check can be posted.`);
const appId = app.appId;
const privateKey = readFileSync(config.appKeyFile, 'utf8');

const shell = slotShell(config.slot);
const image = await shell([
  ...(config.slot.dockerHost === null ? [] : ['env', `DOCKER_HOST=${config.slot.dockerHost}`]),
  'docker',
  'image',
  'inspect',
  '--format',
  `{{ index .Config.Labels "${IMAGE_COMMIT_LABEL}" }}`,
  config.slot.image,
]);
if (image.code !== 0 || image.stdout.trim() !== trustedCommit)
  throw new Error(
    `${config.slot.image} is not built from ${trustedCommit} (${image.stdout.trim() || image.stderr.trim()}); rebuild it as docs/technical/testing.md says.`,
  );

mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
const generation = nextGeneration(join(config.stateDir, 'generation'));
const stateFile = join(config.stateDir, 'state.json');

let cachedToken: { token: string; expiresAt: number } | undefined;
/** The App's installation token, minted anew ten minutes before it expires. */
async function appToken(): Promise<string> {
  const nowS = Math.floor(Date.now() / 1_000);
  if (!cachedToken || cachedToken.expiresAt - 600 < nowS)
    cachedToken = await installationToken({ appId, privateKey, repository: config.repository, nowS, fetch });
  return cachedToken.token;
}
const headers = async () => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${await appToken()}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

const scheduledOf = (run: { head: string; runUrl: string }): ScheduledRun => ({
  runUrl: run.runUrl,
  attempt: 1,
  event: 'pr',
  commit: run.head,
  prHead: undefined,
});

/** The lease's GitHub calls for one run: its start is the run's queued Check (lease.ts). */
function leaseApi(scheduled: ScheduledRun): LeaseApi {
  return {
    async checkRuns(sha) {
      const runs: LeaseCheckRun[] = [];
      for (let page = 1; page <= 10; page++) {
        const response = await fetch(
          `https://api.github.com/repos/${config.repository}/commits/${sha}/check-runs?check_name=Check&app_id=${appId}&filter=all&per_page=100&page=${page}`,
          { headers: await headers(), signal: AbortSignal.timeout(60_000) },
        );
        if (!response.ok) throw new Error(`GitHub answered ${response.status} to the check run list.`);
        const answer = checkRunListSchema.parse(await response.json());
        // A cancelled run left the head without a verdict: it neither holds nor settles it.
        for (const checkRun of answer.check_runs)
          if (checkRun.app?.id === appId && checkRun.conclusion !== 'cancelled')
            runs.push({
              id: checkRun.id,
              completed: checkRun.status === 'completed',
              title: checkRun.output.title,
            });
        if (answer.check_runs.length < 100) return runs;
      }
      throw new Error(`More than 1000 Check runs on ${sha}.`);
    },
    async start(sha, title) {
      const queued = queuedCheckRunOf({ ...scheduled, commit: sha });
      if (!queued || 'problem' in queued)
        throw new Error(`No start can be posted: ${queued?.problem ?? 'a full run'}`);
      const posted = await postCheckRun({
        request: { ...queued.request, output: { ...queued.request.output, title } },
        appId,
        token: await appToken(),
        repository: config.repository,
        fetch,
      });
      if ('problem' in posted) throw new Error(`The start was not posted: ${posted.problem}`);
      return posted.id;
    },
    async renew(checkRun, title) {
      const response = await fetch(
        `https://api.github.com/repos/${config.repository}/check-runs/${checkRun}`,
        {
          method: 'PATCH',
          headers: { ...(await headers()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ output: { title, summary: `Run: ${scheduled.runUrl}` } }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!response.ok) throw new Error(`GitHub answered ${response.status} to the lease's renewal.`);
    },
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  };
}

/** Completes the run's own start with `request`, only while its lease holds (lease.ts, postVerdict). */
const complete = async (current: CurrentRun, now: number, built: ReturnType<typeof checkRunOf>) =>
  'problem' in built
    ? built
    : postVerdict(leaseApi(scheduledOf(current)), current.head, current.held, now, async () =>
        finishCheckRun({
          request: built.request,
          scheduled: scheduledOf(current),
          appId,
          token: await appToken(),
          repository: config.repository,
          fetch,
        }),
      );

const lease: RunLease = {
  claim: (pending, now) =>
    claim(
      leaseApi(scheduledOf({ head: pending.pull.headSha, runUrl: pending.runUrl })),
      pending.pull.headSha,
      { machine: config.machine, generation: pending.generation },
      now,
      config.leaseTtlSeconds,
    ),
  heartbeat: (current, now) =>
    heartbeat(leaseApi(scheduledOf(current)), current.head, current.held, now, config.leaseTtlSeconds),
  verdict: (current, now) =>
    complete(
      current,
      now,
      checkRunOf({
        check: readHandoff(join(current.runDir, 'results', resultFileName('check', null))),
        plan: readHandoff(join(current.runDir, 'results', resultFileName('plan', null))),
        tree: run('git', ['rev-parse', `${current.head}^{tree}`]),
        scheduled: scheduledOf(current),
        now: new Date(),
      }),
    ),
  cancel: (current, now, reason) =>
    complete(
      current,
      now,
      cancelledCheckRunOf({
        scheduled: scheduledOf(current),
        startedAt: new Date(current.startedAt),
        now: new Date(),
        reason,
      }),
    ),
};

/** The run-commit processes this runner started, by process group. */
const children = new Map<number, ChildProcess>();

const ports: RunnerPorts = {
  config,
  generation,
  now: () => Date.now(),
  windows: () => {
    const text = readFileSync(config.windowsFile, 'utf8');
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  },
  pulls: async () => {
    const [owner, name] = config.repository.split('/');
    return pullsFromGitHub(
      JSON.parse(
        run('gh', [
          'api',
          'graphql',
          '--paginate',
          '--slurp',
          '-f',
          `query=${PULLS_QUERY}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
        ]),
      ),
    );
  },
  main: async () => run('gh', ['api', `repos/${config.repository}/commits/main`, '--jq', '.sha']),
  lease,
  runs: {
    async start({ pull, base, runUrl, runDir, generation: runGeneration }) {
      mkdirSync(join(runDir, 'results'), { recursive: true });
      // The private sibling through the runner's own login; only the trusted sibling step sees it.
      const siblingToken = run('gh', ['auth', 'token']);
      const child = spawn(process.execPath, [join(trusted, 'scripts/ci/run-commit.ts')], {
        cwd: trusted,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          NODE_ENV: process.env.NODE_ENV,
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ...(process.env.WSL_INTEROP ? { WSL_INTEROP: process.env.WSL_INTEROP } : {}),
          CI_EVENT: 'pr',
          CI_COMMIT: pull.headSha,
          CI_BASE_SHA: base,
          CI_PRS: String(pull.number),
          CI_PR_HEAD_REF: `refs/pull/${pull.number}/head`,
          CI_RESULTS_DIR: join(runDir, 'results'),
          CI_RUN_URL: runUrl,
          CI_RUN_ATTEMPT: '1',
          CI_WORK_ROOT: join(config.stateDir, 'work'),
          CI_PRODUCER: `machine-runner:${config.machine}`,
          // One job at a time: one Supabase stack per slot (decision 0011, the local profile).
          CI_PARALLEL: '1',
          CI_DEDICATED_HOST: '1',
          CI_EXECUTOR: 'container',
          CI_CONTAINER_SLOT: JSON.stringify(config.slot),
          CI_CONTAINER_GENERATION: String(runGeneration),
          SHRINK_ONLY_GROWTH_APPROVED: String(pull.listGrowthApproved),
          GITHUB_REPOSITORY: config.repository,
          SIBLING_REPOSITORIES_TOKEN: siblingToken,
        },
      });
      const output = join(runDir, 'run.log');
      for (const stream of [child.stdout, child.stderr])
        stream?.on('data', (chunk: Buffer) => writeFileSync(output, chunk, { flag: 'a' }));
      child.once('exit', (code) => {
        writeFileSync(join(runDir, 'exit.json'), JSON.stringify({ exitCode: code }));
        if (child.pid !== undefined) children.delete(child.pid);
      });
      if (child.pid !== undefined) children.set(child.pid, child);
      return { processGroup: child.pid ?? null };
    },
    async status(current) {
      const exit = join(current.runDir, 'exit.json');
      const plan = readHandoff(join(current.runDir, 'results', resultFileName('plan', null)));
      const full = 'unreadable' in plan || !plan.plan ? null : plan.plan.outputs.full === 'true';
      if (existsSync(exit)) {
        const { exitCode } = exitSchema.parse(JSON.parse(readFileSync(exit, 'utf8')));
        return { state: 'ended', exitCode, full };
      }
      // Alive while its process group lives: the heartbeat renews from that liveness alone.
      return current.processGroup !== null && alive(current.processGroup)
        ? { state: 'running' }
        : { state: 'ended', exitCode: null, full };
    },
    async stop(current) {
      if (current.processGroup === null || !alive(current.processGroup)) return;
      // SIGTERM: run-commit stops every job's container (60 s of grace, then SIGKILL), then ends.
      process.kill(-current.processGroup, 'SIGTERM');
      const group = current.processGroup;
      setTimeout(() => {
        if (alive(group)) process.kill(-group, 'SIGKILL');
      }, 4 * 60_000).unref();
    },
  },
  resize: async (command) => {
    const [program, ...args] = command;
    if (program) run(program, args);
  },
  load: () =>
    existsSync(stateFile)
      ? runnerStateSchema.parse(JSON.parse(readFileSync(stateFile, 'utf8')))
      : EMPTY_STATE,
  save: (state: RunnerState) => {
    writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(`${stateFile}.tmp`, stateFile);
  },
  alert: async ({ detail }) => {
    // The existing ci-alert issues: one per machine, kept open with each new alert as a comment.
    const answer = spawnSync(
      'bash',
      [
        join(trusted, '.github/scripts/alert-issue.sh'),
        'keep',
        `CI alert: machine runner ${config.machine}`,
        detail,
      ],
      {
        cwd: trusted,
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_REPO: config.repository,
          ALERT_RUN: `https://github.com/${config.repository}/pulls`,
        },
      },
    );
    log(`[alert] ${detail}${answer.status === 0 ? '' : ` (not filed: ${answer.stderr.trim()})`}`);
  },
  log,
};

function alive(group: number): boolean {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
}

// A restart never resumes: the older generation's run ends, and so do its job containers.
const recovered = await recover(ports);
if (recovered) log(recovered);
const listed = await shell(listCommand(config.slot));
for (const name of otherGenerations(listed.stdout, generation)) {
  await shell(stopCommand(config.slot, name));
  log(`stopped ${name}, a job container of an older generation`);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopping = true;
    log(`${signal}: the run ends as cancelled, then the runner stops`);
  });
log(`machine runner ${config.machine}, generation ${generation}, at ${trustedCommit}`);
while (!stopping) {
  try {
    log(await tick(ports));
  } catch (error) {
    log(`the tick failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (let waited = 0; waited < TICK_MS && !stopping; waited += 1_000)
    await new Promise((done) => setTimeout(done, 1_000));
}
const left = await recover(ports);
if (left) log(left);
