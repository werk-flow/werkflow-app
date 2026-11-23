#!/usr/bin/env bun
// The machine runner of the owner's machines (lib/testing/ci/machine-runner.ts decides; this file
// acts): a user service on the MacBook (launchd) and on the PC (a systemd user unit in the agents'
// WSL distribution) that claims pull requests and runs their integration runs, every 60 s, until it
// is stopped.
// Usage: bun scripts/ci/machine-runner.ts --config <machine config file>
// It runs only from the configuration's `trustedCheckout`, a clean clone at a reviewed commit, only
// while main's CI profile is `local`, only with an image built from that commit (run by its
// immutable id), and only once a probe job showed that the slot cannot read this side's files or
// reach its ports. It holds the credentials: its `gh` login reads GitHub, pushes the lease refs
// (`refs/leases/ci/<sha>`), files the alerts and clones the private sibling; the CI App's key
// (`appKeyFile`) mints the token its Check check runs are written with. Each run is
// `scripts/ci/run-commit.ts` with the container executor (CI_EXECUTOR=container), beside a watchdog
// (scripts/ci/machine-watchdog.ts) that stops it before the window turns off. Install and operate it
// as docs/technical/machine-setup.md ("Run CI on the owner's machines") says.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CHECK_APP_CONFIG,
  cancelledCheckRunOf,
  checkRunOf,
  completeCheckRun,
  postCheckRun,
  queuedCheckRunOf,
  readCheckApp,
  readHandoff,
  type ScheduledRun,
} from '../../lib/testing/ci/check-app';
import { installationToken } from '../../lib/testing/ci/check-app-token';
import {
  docker,
  IMAGE_COMMIT_LABEL,
  listCommand,
  otherGenerations,
  probeCommand,
  stackListCommand,
} from '../../lib/testing/ci/container-slot';
import { nextGeneration, type RefValue } from '../../lib/testing/ci/lease';
import {
  type Completion,
  type CurrentRun,
  EMPTY_STATE,
  endProcessGroup,
  type MachineConfig,
  machineConfigSchema,
  recover,
  type RunnerPorts,
  type RunnerState,
  runnerStateSchema,
  TICK_MS,
  tick,
} from '../../lib/testing/ci/machine-runner';
import { RUNNER_PULLS_QUERY, runnerPullsFromGitHub } from '../../lib/testing/ci/machine-pulls';
import { activeProfile, MAIN_REFSPEC } from '../../lib/testing/ci/profiles';
import { resultFileName } from '../../lib/testing/ci/results';
import { runKeyOf } from '../../lib/testing/ci/run-commit';
import { z } from '../../lib/zod';
import { clearRun, clearStacks, slotShell } from './container-executor';
import { runCommitSignal } from './machine-watchdog';

const exitSchema = z.object({ exitCode: z.number().int().nullable() });

const { values } = parseArgs({ options: { config: { type: 'string' } } });
if (!values.config) throw new Error('Usage: bun scripts/ci/machine-runner.ts --config <machine config file>');
const config: MachineConfig = machineConfigSchema.parse(JSON.parse(readFileSync(values.config, 'utf8')));
const trusted = resolve(config.trustedCheckout);
const log = (line: string): void => console.info(`[${new Date().toISOString()}] ${line}`);
const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A command's result in the trusted checkout. */
function exec(command: string, args: readonly string[], env: Record<string, string> = {}) {
  return spawnSync(command, args, {
    cwd: trusted,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 ** 2,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
  });
}
/** A command's output, or a throw that names it. */
function run(command: string, args: readonly string[], env: Record<string, string> = {}): string {
  const answer = exec(command, args, env);
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
/** main's CI profile, from the switch on main as just fetched (profiles.ts). */
function profileName(): string {
  run('git', ['fetch', '--quiet', '--no-tags', 'origin', MAIN_REFSPEC]);
  return activeProfile().profile.name;
}
if (profileName() !== 'local')
  throw new Error("main's CI profile is not local, so the machine runner does not start.");
const app = readCheckApp(join(trusted, CHECK_APP_CONFIG));
if ('problem' in app) throw new Error(app.problem);
if (app.appId === null) throw new Error(`${CHECK_APP_CONFIG} names no CI App, so no Check can be posted.`);
const appId = app.appId;
// The CI App's key: one file on this trusted side, which only its owner reads.
if ((statSync(config.appKeyFile).mode & 0o077) !== 0)
  throw new Error(`${config.appKeyFile} is readable by others; run chmod 600 on it.`);
const privateKey = readFileSync(config.appKeyFile, 'utf8');

const shell = slotShell(config.slot);
/** The image's immutable id and its label, through the slot. */
async function inspectImage(): Promise<{ id: string; commit: string } | { problem: string }> {
  const answer = await shell(
    docker(
      config.slot,
      'image',
      'inspect',
      '--format',
      `{{.Id}} {{ index .Config.Labels "${IMAGE_COMMIT_LABEL}" }}`,
      config.slot.image,
    ),
    { timeoutMs: 60_000 },
  );
  const [id, commit] = answer.stdout.trim().split(' ');
  if (answer.code !== 0 || !id?.startsWith('sha256:') || !commit)
    return { problem: `${config.slot.image} cannot be inspected on the slot: ${answer.stderr.trim()}` };
  return { id, commit };
}
const inspected = await inspectImage();
if ('problem' in inspected) throw new Error(inspected.problem);
if (inspected.commit !== trustedCommit)
  throw new Error(
    `${config.slot.image} is built from ${inspected.commit}, not ${trustedCommit}; rebuild it as machine-setup.md says.`,
  );
const imageId = inspected.id;
/** The slot as run-commit gets it: the image by its id, never by a tag a job could move. */
const slot = { ...config.slot, image: imageId };

// The boundary, before any claim: a job of this slot reads none of this side's files and reaches
// none of its ports. Each sentinel holds a random token; the probe looks for it.
{
  const token = randomBytes(24).toString('hex');
  const sentinels = [
    join(dirname(config.appKeyFile), '.werkflow-ci-probe'),
    join(trusted, '.git', 'werkflow-ci-probe'),
    join(homedir(), '.werkflow-ci-probe'),
  ];
  for (const path of sentinels) writeFileSync(path, `${token}\n`, { mode: 0o600 });
  const probed = await shell(
    probeCommand(slot, { image: imageId, token, sentinels, ports: config.probePorts }),
    {
      timeoutMs: 300_000,
    },
  );
  for (const path of sentinels) rmSync(path, { force: true });
  if (probed.code !== 0)
    throw new Error(
      `The slot's boundary does not hold, so the runner claims nothing: ${probed.stderr.trim() || probed.stdout.trim()}`,
    );
}

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
const access = async () => ({ appId, token: await appToken(), repository: config.repository, fetch });

const scheduledOf = (head: string, runUrl: string): ScheduledRun => ({
  runUrl,
  attempt: 1,
  event: 'integration',
  commit: head,
  prHead: undefined,
});

/** Git's credentials for a push: the `gh` login's token as a header, never in an argument or a file. */
const pushAuth = (): Record<string, string> => ({
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
  GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${run('gh', ['auth', 'token'])}`).toString('base64')}`,
});
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const leaseRef = (sha: string): string => `refs/leases/ci/${sha}`;
const remoteOid = (sha: string): string | null =>
  run('git', ['ls-remote', 'origin', leaseRef(sha)], pushAuth()).split('\t')[0] || null;

const refs: RunnerPorts['refs'] = {
  async read(sha) {
    const oid = remoteOid(sha);
    if (oid === null) return null;
    run('git', ['fetch', '--quiet', '--no-tags', 'origin', leaseRef(sha)], pushAuth());
    return { oid, message: run('git', ['log', '-1', '--format=%B', oid]) };
  },
  async swap(sha, expected, message): Promise<RefValue | null> {
    const oid = run(
      'git',
      ['commit-tree', EMPTY_TREE, ...(expected ? ['-p', expected] : []), '-m', message],
      {
        GIT_AUTHOR_NAME: `machine runner ${config.machine}`,
        GIT_AUTHOR_EMAIL: 'machine-runner@users.noreply.github.com',
        GIT_COMMITTER_NAME: `machine runner ${config.machine}`,
        GIT_COMMITTER_EMAIL: 'machine-runner@users.noreply.github.com',
      },
    );
    const pushed = exec(
      'git',
      [
        'push',
        '--quiet',
        '--porcelain',
        'origin',
        `${oid}:${leaseRef(sha)}`,
        `--force-with-lease=${leaseRef(sha)}:${expected ?? ''}`,
      ],
      pushAuth(),
    );
    if (pushed.status === 0) return { oid, message };
    // A lost answer: the ref holds this push's commit, so the swap happened.
    const now = remoteOid(sha);
    if (now === oid) return { oid, message };
    if (/rejected|stale info/.test(`${pushed.stdout}${pushed.stderr}`)) return null;
    throw new Error(`The lease ref ${leaseRef(sha)} could not be pushed: ${pushed.stderr.trim()}`);
  },
  async remove(sha, expected) {
    return (
      exec(
        'git',
        ['push', '--quiet', 'origin', `--force-with-lease=${leaseRef(sha)}:${expected}`, `:${leaseRef(sha)}`],
        pushAuth(),
      ).status === 0
    );
  },
  async list() {
    return run('git', ['ls-remote', 'origin', 'refs/leases/ci/*'], pushAuth())
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [oid = '', ref = ''] = line.split('\t');
        return { oid, sha: ref.slice('refs/leases/ci/'.length) };
      });
  },
};

const checks: RunnerPorts['checks'] = {
  async start({ head, runUrl }) {
    const queued = queuedCheckRunOf(scheduledOf(head, runUrl));
    if (!queued || 'problem' in queued)
      throw new Error(`No start can be posted: ${queued?.problem ?? 'a full run'}`);
    const posted = await postCheckRun({ request: queued.request, ...(await access()) });
    if ('problem' in posted) throw new Error(`The start was not posted: ${posted.problem}`);
    return posted.id;
  },
  async complete(completion: Completion) {
    const scheduled = scheduledOf(completion.head, completion.runUrl);
    const cancelled = (reason: string) =>
      cancelledCheckRunOf({ scheduled, startedAt: new Date(completion.startedAt), now: new Date(), reason });
    const built =
      completion.kind === 'cancelled'
        ? cancelled(completion.reason)
        : checkRunOf({
            check: readHandoff(join(completion.runDir, 'results', resultFileName('check', null))),
            plan: readHandoff(join(completion.runDir, 'results', resultFileName('plan', null))),
            tree: run('git', ['rev-parse', `${completion.head}^{tree}`]),
            scheduled,
            now: new Date(),
          });
    // A verdict that cannot be built from the run's results is no verdict: the Check ends cancelled.
    const request = 'problem' in built ? cancelled(`No verdict: ${built.problem}`) : built;
    if ('problem' in request) throw new Error(request.problem);
    const summary = `${request.request.output.summary}\nList growth approved: ${completion.approval ? 'yes' : 'no'}`;
    const posted = await completeCheckRun({
      request: { ...request.request, output: { ...request.request.output, summary } },
      id: completion.checkRun,
      ...(await access()),
    });
    if ('problem' in posted) throw new Error(posted.problem);
  },
};

const alive = (group: number): boolean => {
  try {
    process.kill(-group, 0);
    return true;
  } catch {
    return false;
  }
};
const children = new Map<number, ChildProcess>();
const runKeyOfRun = (current: CurrentRun): string => runKeyOf(current.runUrl, 1);
const ended = (runDir: string): void => {
  const exit = join(runDir, 'exit.json');
  if (!existsSync(exit)) writeFileSync(exit, JSON.stringify({ exitCode: null }));
};

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
  profile: async () => profileName(),
  pulls: async () => {
    const [owner, name] = config.repository.split('/');
    return runnerPullsFromGitHub(
      JSON.parse(
        run('gh', [
          'api',
          'graphql',
          '--paginate',
          '--slurp',
          '-f',
          `query=${RUNNER_PULLS_QUERY}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
        ]),
      ),
    );
  },
  main: async () => run('gh', ['api', `repos/${config.repository}/commits/main`, '--jq', '.sha']),
  head: async (sha, base) => {
    run('git', ['fetch', '--quiet', '--no-tags', 'origin', sha, base]);
    return {
      upToDate: exec('git', ['merge-base', '--is-ancestor', base, sha]).status === 0,
      snapshotReader:
        exec('git', ['cat-file', '-e', `${sha}:lib/testing/ci/github-snapshot.ts`]).status === 0,
    };
  },
  image: async () => {
    const now = await inspectImage();
    if ('problem' in now) return now.problem;
    return now.id === imageId && now.commit === trustedCommit
      ? undefined
      : `${config.slot.image} changed on the slot since the runner verified ${imageId}; restart the runner after a rebuild.`;
  },
  refs,
  checks,
  runs: {
    async start({ pull, base, runUrl, runDir, stopBy }) {
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
          // The integration run of the PR's up-to-date head: the browser groups the plan selects
          // included, as the queue's integration run tests a landing (lib/testing/ci/dag.ts).
          CI_EVENT: 'integration',
          CI_COMMIT: pull.headSha,
          CI_BASE_SHA: base,
          CI_PRS: String(pull.number),
          CI_RESULTS_DIR: join(runDir, 'results'),
          CI_RUN_URL: runUrl,
          CI_RUN_ATTEMPT: '1',
          CI_WORK_ROOT: join(config.stateDir, 'work'),
          CI_PRODUCER: `machine-runner:${config.machine}`,
          // One job at a time: one Supabase stack per slot (decision 0011, the local profile).
          CI_PARALLEL: '1',
          CI_DEDICATED_HOST: '1',
          CI_EXECUTOR: 'container',
          CI_CONTAINER_SLOT: JSON.stringify(slot),
          CI_CONTAINER_GENERATION: String(generation),
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
      if (child.pid === undefined) return { processGroup: null };
      children.set(child.pid, child);
      // The window's watchdog: a process of its own, which stops the run at its stop-by instant
      // even when this runner hangs, dies or cannot reach GitHub.
      if (stopBy !== null)
        spawn(
          process.execPath,
          [
            join(trusted, 'scripts/ci/machine-watchdog.ts'),
            '--at',
            String(stopBy),
            '--group',
            String(child.pid),
            '--run-key',
            runKeyOf(runUrl, 1),
            '--run-dir',
            runDir,
            '--slot',
            JSON.stringify(slot),
          ],
          {
            cwd: trusted,
            detached: true,
            stdio: 'ignore',
            env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME },
          },
        ).unref();
      return { processGroup: child.pid };
    },
    async status(current) {
      const exit = join(current.runDir, 'exit.json');
      const plan = readHandoff(join(current.runDir, 'results', resultFileName('plan', null)));
      const planned = 'unreadable' in plan || !plan.plan ? null : plan.plan;
      if (existsSync(exit))
        return {
          state: 'ended',
          exitCode: exitSchema.parse(JSON.parse(readFileSync(exit, 'utf8'))).exitCode,
          full: planned ? planned.outputs.full === 'true' : null,
        };
      return current.processGroup !== null && alive(current.processGroup)
        ? { state: 'running', plan: planned }
        : { state: 'ended', exitCode: null, full: null };
    },
    async stop(current) {
      const gone =
        current.processGroup === null ||
        (await endProcessGroup(current.processGroup, runCommitSignal(current.processGroup), wait));
      const left = await clearRun(shell, slot, runKeyOfRun(current));
      // The run counts as ended, so its watchdog leaves the slot to the next run.
      ended(current.runDir);
      if (!gone)
        return {
          clean: false,
          reason: `run-commit's process group ${current.processGroup} outlived SIGKILL`,
        };
      return left === undefined ? { clean: true } : { clean: false, reason: left };
    },
    async clean() {
      const listed = await shell(listCommand(slot), { timeoutMs: 120_000 });
      if (listed.code !== 0)
        return { clean: false, reason: `the slot cannot be listed: ${listed.stderr.trim()}` };
      const names = listed.stdout
        .split('\n')
        .map((line) => line.trim().split(' ')[0] ?? '')
        .filter(Boolean);
      if (names.length) await shell(docker(slot, 'rm', '--force', ...names), { timeoutMs: 120_000 });
      const stacks = await clearStacks(shell, slot);
      const again = await shell(listCommand(slot), { timeoutMs: 120_000 });
      const stackList = await shell(stackListCommand(slot), { timeoutMs: 120_000 });
      if (
        again.code !== 0 ||
        again.stdout.trim() !== '' ||
        stackList.stdout.trim() !== '' ||
        stacks !== undefined
      )
        return { clean: false, reason: stacks ?? `containers stay on the slot: ${again.stdout.trim()}` };
      return { clean: true };
    },
  },
  nextAttempt: () => nextGeneration(join(config.stateDir, 'attempt')),
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
    const answer = exec(
      'bash',
      [
        join(trusted, '.github/scripts/alert-issue.sh'),
        'keep',
        `CI alert: machine runner ${config.machine}`,
        detail,
      ],
      {
        GH_REPO: config.repository,
        ALERT_RUN: `https://github.com/${config.repository}/pulls`,
      },
    );
    log(
      `[alert] ${detail}${answer.status === 0 ? '' : ` (not delivered, retried next tick: ${answer.stderr.trim()})`}`,
    );
    return answer.status === 0;
  },
  log,
};

// A restart never resumes: the older generation's run ends, and so do its containers.
const recovered = await recover(ports);
if (recovered) log(recovered);
const listed = await shell(listCommand(slot), { timeoutMs: 120_000 });
const older = otherGenerations(listed.stdout, generation);
if (older.length) {
  await shell(docker(slot, 'rm', '--force', ...older), { timeoutMs: 120_000 });
  log(`removed ${older.join(', ')}, containers of an older generation`);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopping = true;
    log(`${signal}: the run ends as cancelled, then the runner stops`);
  });
log(`machine runner ${config.machine}, generation ${generation}, at ${trustedCommit}, image ${imageId}`);
while (!stopping) {
  try {
    log(await tick(ports));
  } catch (error) {
    log(`the tick failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (let waited = 0; waited < TICK_MS && !stopping; waited += 1_000) await wait(1_000);
}
const left = await recover(ports);
if (left) log(left);
