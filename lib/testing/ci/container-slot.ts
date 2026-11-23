// The container slot of the owner's machines (decision 0011, local profile): every job of a run in
// a container of its own, from the CI image (ci/image/Dockerfile), on the slot's own Docker. The
// trusted side, run-commit with the machine runner's credentials, reaches the slot only through a
// command prefix (the Mac: none; the PC: `wsl.exe -d werkflow-ci -u cirunner --`) and hands a job
// its inputs only as a tar stream: the sibling clones, the results so far and the GitHub snapshot.
// scripts/ci/container-executor.ts runs it; this module holds what decides: the slot's
// configuration, the names and folders, the docker commands and the job's environment.
import { z } from 'zod';
import type { Unit } from './run-commit';
import { unitName } from './run-commit';

export const slotConfigSchema = z.strictObject({
  /** Runs a command on the slot host: [] on the Mac, the `wsl.exe … --` prefix on the PC. */
  prefix: z.array(z.string().min(1)),
  /** DOCKER_HOST of the slot's Docker, or null for the docker CLI's default. */
  dockerHost: z.string().min(1).nullable(),
  /** The slot's Docker socket on the slot host, mounted into a job for its Supabase stack. */
  socket: z.string().startsWith('/'),
  /** The slot host's folder for the git cache and the runs' workspaces. Mounted at its own path. */
  root: z.string().startsWith('/'),
  /** The CI image's tag. Its label `org.werkflow.trusted-commit` names the commit it was built from. */
  image: z.string().min(1),
  /** `root` on a rootless slot, whose container root is the slot's own unprivileged user. */
  containerUser: z.enum(['image', 'root']),
});
export type SlotConfig = z.infer<typeof slotConfigSchema>;

/** The label every job container carries, with the machine runner's generation as its value. */
const RUN_LABEL = 'org.werkflow.ci-generation';
/** The image label that names the trusted commit the image was built from. */
export const IMAGE_COMMIT_LABEL = 'org.werkflow.trusted-commit';

/** The bare clone of GitHub's repository on the slot, which every workspace shares objects from. */
const gitCache = (config: SlotConfig): string => `${config.root}/git/werkflow-app.git`;

/** One job start's folder on the slot: its checkout, sibling clones, results and log. */
export function workspaceOf(config: SlotConfig, runKey: string, unit: Unit): string {
  if (!/^[0-9a-f]{16}-[1-9][0-9]*$/.test(runKey)) throw new Error(`${runKey} is no run key.`);
  return `${config.root}/runs/${runKey}/${unitName(unit)}`;
}

/** The job's container: named after the run and the unit, so a stop names exactly it. */
export const containerName = (runKey: string, unit: Unit): string =>
  `werkflow-ci-${runKey}-${unitName(unit)}`;

/** `docker` on the slot host, with the slot's DOCKER_HOST. */
export const docker = (config: SlotConfig, ...args: string[]): string[] =>
  config.dockerHost === null
    ? ['docker', ...args]
    : ['env', `DOCKER_HOST=${config.dockerHost}`, 'docker', ...args];

/**
 * The task variables a job container takes (run-commit's run variables, scripts/ci/job.ts names
 * them) and the executor's own. Every other name is dropped: a token in the task never reaches a
 * job, nor does the slot's or the runner's environment.
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

/**
 * The job container's environment: the task's run variables from JOB_VARIABLES, and the folders
 * and switches of the slot. Throws on a value that looks like a GitHub token.
 */
export function jobEnvironment(
  task: { env: Readonly<Record<string, string>>; unit: Unit },
  workspace: string,
  extra: { jobStartedAt: string; machineStart: boolean },
): Record<string, string> {
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

/** The volumes every job shares: Bun's and Playwright's caches. */
const CACHE_VOLUMES = [
  'werkflow-ci-bun-cache:/home/runner/.bun/install/cache',
  'werkflow-ci-playwright-cache:/home/runner/.cache/ms-playwright',
];

/**
 * The command that runs one job in its container until it ends, attached so its exit is the job's.
 * The workspace is mounted at its own path, as the job's Supabase stack mounts paths of it through
 * the slot's socket; `--network host` keeps the stack's fixed ports reachable; the git cache is
 * read only. Nothing else of the slot host is mounted.
 */
export function jobCommand(
  config: SlotConfig,
  job: {
    name: string;
    generation: number;
    workspace: string;
    environment: Record<string, string>;
    unit: Unit;
  },
): string[] {
  return docker(
    config,
    'run',
    '--rm',
    '--init',
    '--name',
    job.name,
    '--label',
    `${RUN_LABEL}=${job.generation}`,
    '--network',
    'host',
    '--volume',
    `${config.socket}:/var/run/docker.sock`,
    '--volume',
    `${job.workspace}:${job.workspace}`,
    '--volume',
    `${gitCache(config)}:${gitCache(config)}:ro`,
    ...CACHE_VOLUMES.flatMap((volume) => ['--volume', volume]),
    ...(config.containerUser === 'root' ? ['--user', '0'] : []),
    ...Object.entries(job.environment).flatMap(([name, value]) => ['--env', `${name}=${value}`]),
    '--workdir',
    `${job.workspace}/werkflow-app`,
    config.image,
    'werkflow-ci-job',
    job.unit.job,
  );
}

/**
 * The command that makes a job's workspace from the tar on its standard input: the staged inputs,
 * then a clone of `commit` from the slot's git cache, which fetches GitHub first and takes an
 * incremental bundle from the stream for a commit GitHub lacks (a queue commit).
 */
export function stageCommand(
  config: SlotConfig,
  stage: { workspace: string; commit: string; repository: string },
): string[] {
  return docker(
    config,
    'run',
    '--rm',
    '--interactive',
    '--volume',
    `${config.root}:${config.root}`,
    ...(config.containerUser === 'root' ? ['--user', '0'] : []),
    config.image,
    'werkflow-ci-stage',
    stage.workspace,
    gitCache(config),
    stage.commit,
    `https://github.com/${stage.repository}.git`,
  );
}

/** Stops a job container: SIGTERM, 60 s of grace, then SIGKILL. */
export const stopCommand = (config: SlotConfig, name: string): string[] =>
  docker(config, 'stop', '--time', '60', name);

/** The job containers alive on the slot, as `<name> <generation>` lines. */
export const listCommand = (config: SlotConfig): string[] =>
  docker(config, 'ps', '--filter', `label=${RUN_LABEL}`, '--format', `{{.Names}} {{.Label "${RUN_LABEL}"}}`);

/** The containers of a Supabase stack on the slot: a stopped job's stack the next one replaces. */
export const stackListCommand = (config: SlotConfig): string[] =>
  docker(config, 'ps', '--all', '--quiet', '--filter', 'label=com.supabase.cli.project');

/** The job containers of generations other than `generation`, from `listCommand`'s output. */
export function otherGenerations(listed: string, generation: number): string[] {
  return listed
    .split('\n')
    .map((line) => line.trim().split(' '))
    .filter(([name, label]) => name && label !== String(generation))
    .map(([name]) => name ?? '');
}
