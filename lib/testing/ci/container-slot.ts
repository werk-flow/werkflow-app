// The container slot of the owner's machines (decision 0011, local profile): every job of a run in
// a container of its own, from the CI image (ci/image/Dockerfile) by its immutable id, on the slot's
// own Docker. The trusted side, run-commit with the machine runner's credentials, reaches the slot
// only through a command prefix (the Mac: `colima ssh --profile ci --`, a VM without host mounts;
// the PC: `wsl.exe -d werkflow-ci -u cirunner --`) and hands a job its inputs only as a tar stream:
// the public sibling clone, the results so far and the GitHub snapshot. scripts/ci/container-executor.ts
// runs it; this module holds what decides: the slot's configuration, the names and folders, the
// docker commands and the job's environment.
import { z } from 'zod';
import type { Unit } from './run-commit';
import { unitName } from './run-commit';

export const slotConfigSchema = z.strictObject({
  /** Runs a command on the slot host: the Colima `ci` profile's ssh on the Mac, the `wsl.exe … --` prefix on the PC. */
  prefix: z.array(z.string().min(1)),
  /** DOCKER_HOST of the slot's Docker, or null for the docker CLI's default on the slot host. */
  dockerHost: z.string().min(1).nullable(),
  /** The slot's Docker socket on the slot host, mounted into a job for its Supabase stack. */
  socket: z.string().startsWith('/'),
  /** The slot host's own folder for the git cache and the runs' workspaces. Mounted at its own path. */
  // No trailing slash: a read compares its open file's path with the one derived from the root.
  root: z.string().regex(/^\/(?:.*[^/])?$/, 'is an absolute path without a trailing slash'),
  /**
   * The CI image: its tag in the configuration; the runner resolves it to its immutable id, checks
   * the label `org.werkflow.trusted-commit`, and hands run-commit the id.
   */
  image: z.string().min(1),
  /** `root` on a rootless slot, whose container root is the slot's own unprivileged user. */
  containerUser: z.enum(['image', 'root']),
});
export type SlotConfig = z.infer<typeof slotConfigSchema>;

/** The image label that names the trusted commit the image was built from. */
export const IMAGE_COMMIT_LABEL = 'org.werkflow.trusted-commit';
/** The whole teardown of the slot after a job, a run or a stop (scripts/ci/container-executor.ts, clearSlot). */
export const TEARDOWN_MS = 3 * 60_000;
/** The largest result or file the trusted side reads back from the slot. */
export const READ_LIMIT_BYTES = 8 * 1024 ** 2;

/** The bare clone of GitHub's repository on the slot, which every workspace shares objects from. */
const gitCache = (config: SlotConfig): string => `${config.root}/git/werkflow-app.git`;

/** A run's folder on the slot. */
export function runFolder(config: SlotConfig, runKey: string): string {
  if (!/^[0-9a-f]{16}-[1-9][0-9]*$/.test(runKey)) throw new Error(`${runKey} is no run key.`);
  return `${config.root}/runs/${runKey}`;
}

/**
 * The one path every job of a run works in, a job at a time: a browser shard then unpacks Fast's
 * build at the path the build was made in (CI_BUILD_TAR, scripts/ci/job.ts). After a job its
 * workspace moves to `keptOf`.
 */
export const workspaceOf = (config: SlotConfig, runKey: string): string => `${runFolder(config, runKey)}/app`;
/** Where a job's workspace stays after it ended: the run's release removes a passed one. */
export const keptOf = (config: SlotConfig, runKey: string, unit: Unit): string =>
  `${runFolder(config, runKey)}/${unitName(unit)}`;
/** The folder Fast writes its build tar into and a browser shard reads it from. */
const buildFolder = (config: SlotConfig, runKey: string): string => `${runFolder(config, runKey)}/build`;

/** The job's container: named after the run and the unit, so a stop names exactly it. */
export const containerName = (runKey: string, unit: Unit): string =>
  `werkflow-ci-${runKey}-${unitName(unit)}`;
/** Every container of a run starts with this name. */
const runPrefix = (runKey: string): string => `werkflow-ci-${runKey}-`;

/** `docker` on the slot host, with the slot's DOCKER_HOST. */
export const docker = (config: SlotConfig, ...args: string[]): string[] =>
  config.dockerHost === null
    ? ['docker', ...args]
    : ['env', `DOCKER_HOST=${config.dockerHost}`, 'docker', ...args];

/**
 * The task variables a job container takes (run-commit's run variables, scripts/ci/job.ts names
 * them). Every other name is dropped: a token in the task never reaches a job, nor does the slot's
 * or the runner's environment.
 */
const JOB_VARIABLES = new Set([
  'CI_EVENT',
  'CI_RUN_URL',
  'CI_RUN_ATTEMPT',
  'CI_BASE_SHA',
  'CI_FULL_REASON',
  'CI_PRODUCER',
  'CI_PRS',
  'CI_PR_HEAD_REF',
  'CI_PR_HEAD_SHA',
  'CI_FIRST_ATTEMPT_CLASS',
  'CI_SHARD',
  'CI_NEEDS',
  'SHRINK_ONLY_GROWTH_APPROVED',
  'GITHUB_REPOSITORY',
]);

/** Names a credential may hide under; such a variable never enters a job, whatever the list says. */
const CREDENTIAL_NAME = /TOKEN|SECRET|PASSWORD|PRIVATE|_KEY$|^GH_|^GITHUB_(?!REPOSITORY$)/;
/** GitHub's token formats: a value that matches one never enters a job. */
const CREDENTIAL_VALUE = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/;

/** Whether the job hands Fast's build to the browser shards, or takes it. */
const usesBuild = (unit: Unit): boolean => unit.job === 'fast' || unit.job === 'browser';

/**
 * The job container's environment: the task's run variables from JOB_VARIABLES, and the folders
 * and switches of the slot. Throws on a value that looks like a GitHub token.
 */
export function jobEnvironment(
  config: SlotConfig,
  task: { env: Readonly<Record<string, string>>; unit: Unit },
  runKey: string,
  extra: { jobStartedAt: string; machineStart: boolean },
): Record<string, string> {
  const workspace = workspaceOf(config, runKey);
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(task.env))
    if (JOB_VARIABLES.has(name) && !CREDENTIAL_NAME.test(name)) environment[name] = value;
  Object.assign(environment, {
    CI_RESULTS_DIR: `${workspace}/results`,
    CI_CACHE_DIR: `${workspace}/cache`,
    CI_JOB_STARTED_AT: extra.jobStartedAt,
    CI_MACHINE_START: String(extra.machineStart),
    // The slot's Docker serves CI alone: a job's stack replaces one a stopped job left.
    CI_REPLACE_STACK: '1',
    GITHUB_ENV: `${workspace}/job.env`,
    // Jobs read GitHub from this snapshot: they hold no token (lib/testing/ci/github-snapshot.ts).
    WERKFLOW_GITHUB_SNAPSHOT: `${workspace}/github-snapshot.json`,
    ...(usesBuild(task.unit) ? { CI_BUILD_TAR: `${buildFolder(config, runKey)}/build.tar` } : {}),
    NODE_OPTIONS: '--max-old-space-size=4096',
    TMPDIR: `${workspace}/tmp`,
    HOME: '/home/runner',
    TZ: 'UTC',
    CI: 'true',
  });
  const leaked = Object.entries(environment).find(([, value]) => CREDENTIAL_VALUE.test(value));
  if (leaked) throw new Error(`${leaked[0]} holds a credential; a job container never gets one.`);
  return environment;
}

/**
 * The command that runs one job in its container until it ends, attached so its exit is the job's.
 * The workspace is mounted at its own path, as the job's Supabase stack mounts paths of it through
 * the slot's socket; `--network host` keeps the stack's fixed ports reachable; the git cache is read
 * only, the build folder writable only for Fast. Nothing else persists: Bun installs into the
 * container, and Playwright's browsers are in the image.
 */
export function jobCommand(
  config: SlotConfig,
  job: { runKey: string; environment: Record<string, string>; unit: Unit; image: string },
): string[] {
  const workspace = workspaceOf(config, job.runKey);
  const build = buildFolder(config, job.runKey);
  return docker(
    config,
    'run',
    '--rm',
    '--init',
    '--name',
    containerName(job.runKey, job.unit),
    '--network',
    'host',
    '--volume',
    `${config.socket}:/var/run/docker.sock`,
    '--volume',
    `${workspace}:${workspace}`,
    '--volume',
    `${gitCache(config)}:${gitCache(config)}:ro`,
    ...(usesBuild(job.unit) ? ['--volume', `${build}:${build}${job.unit.job === 'fast' ? '' : ':ro'}`] : []),
    ...(config.containerUser === 'root' ? ['--user', '0'] : []),
    ...Object.entries(job.environment).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--workdir',
    `${workspace}/werkflow-app`,
    job.image,
    'werkflow-ci-job',
    job.unit.job,
  );
}

/**
 * The command that makes the run's workspace from the tar on its standard input (the public
 * sibling, the results so far, the GitHub snapshot), then a clone of `commit` from the slot's git
 * cache of GitHub. A run's commit is a PR head, which GitHub holds; a queue commit is slice B's.
 */
export function stageCommand(
  config: SlotConfig,
  stage: { runKey: string; commit: string; repository: string; image: string },
): string[] {
  return docker(
    config,
    'run',
    '--rm',
    '--interactive',
    '--name',
    `${runPrefix(stage.runKey)}stage`,
    '--volume',
    `${config.root}:${config.root}`,
    ...(config.containerUser === 'root' ? ['--user', '0'] : []),
    stage.image,
    'werkflow-ci-stage',
    workspaceOf(config, stage.runKey),
    buildFolder(config, stage.runKey),
    gitCache(config),
    stage.commit,
    `https://github.com/${stage.repository}.git`,
  );
}

/**
 * Reads a result of the slot in one open: the shell opens `path` once, then checks through that open
 * descriptor that it is a regular file whose resolved path is `path` itself (no link anywhere on the
 * way), and copies at most READ_LIMIT_BYTES + 1 bytes from it. The caller refuses a longer answer.
 */
export const readCommand = (path: string): string[] => [
  // The deadline lives on the slot too: an open that blocks (a FIFO) dies there.
  'timeout',
  '60',
  'sh',
  '-c',
  'exec 3< "$1" && test -f /proc/$$/fd/3 && test "$(readlink /proc/$$/fd/3)" = "$1" && exec head -c "$2" <&3',
  'read',
  path,
  String(READ_LIMIT_BYTES + 1),
];

/** Stops a container: SIGTERM, 60 s of grace, then SIGKILL. */
export const stopCommand = (config: SlotConfig, name: string): string[] =>
  docker(config, 'stop', '--time', '60', name);

/**
 * The start probe (ci/image/probe.sh): a job's container, given the slot's socket as every job is,
 * must find none of the sentinels the runner wrote on its side (beside the App key, in the trusted
 * checkout, in the owner's home), neither in its own view nor through a container that mounts the
 * slot host's root, and must reach none of `ports`.
 */
export function probeCommand(
  config: SlotConfig,
  probe: { image: string; token: string; sentinels: readonly string[]; ports: readonly string[] },
): string[] {
  return docker(
    config,
    'run',
    '--rm',
    '--name',
    `werkflow-ci-probe-${probe.token.slice(0, 12)}`,
    '--network',
    'host',
    '--volume',
    `${config.socket}:/var/run/docker.sock`,
    ...(config.containerUser === 'root' ? ['--user', '0'] : []),
    '--env',
    `WERKFLOW_PROBE_IMAGE=${probe.image}`,
    probe.image,
    'werkflow-ci-probe',
    probe.token,
    probe.sentinels.join(','),
    probe.ports.join(','),
  );
}
