import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  renameSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { z } from '../../zod';

import { captureInputSnapshot, changedInputs } from '../evidence/group-evidence';
import {
  backendIdentity,
  backendValueDigests,
  parseEnvironmentFile,
  proofEnvironmentDigest,
} from '../evidence/proof-environment';
import {
  type MigrationDrift,
  driftLine,
  readMigrationDrift,
  readsSharedStack,
} from '../local-stack/migration-drift';
import { withWorkspaceTestLock } from '../runner/workspace-test-lock';
import { pruneRunArchive } from '../runs/run-retention';
import { BoatError, boatClient } from './boat-api';
import { type BoatKeyReading, RENEW_ADVICE, readBoatKey, withBoatKey } from './boat-key';
import { type BoatUnavailable, retryingStart } from './boat-unavailable';
import { type TransferContext, type TransferPolicy, transfer } from './boat-transfer';
import {
  createMachine,
  deleteMachine,
  machineUsage,
  runScript,
  shellQuote,
  type Machine,
} from './boat-machine';

// `bun run test:verify` runs on a short-lived Boat machine when this workstation has a Boat key
// (docs/technical/boat-verification.md). The machine plans and runs the same command on the same
// tree and evidence, at the same absolute path, so selection, proofs, reports and .agent-logs/
// come back as a local run writes them. When Boat is unavailable, only the cheap groups run here:
// the heavy ones are recorded blocked unless WERKFLOW_VERIFY_LOCAL=1 asks for them.

/** The saved snapshot every verification machine starts from (scripts/boat/build-snapshot.ts). */
export const SNAPSHOT_NAME = 'werkflow-verify';
/** The machine's home folder, where a run's files go. */
const HOME = '/home/user';
/** remote-verify.sh's exit code when setup failed before test:verify started. */
const SETUP_FAILED = 90;
/** A hard stop for a machine whose run or deletion went wrong; without snapshots it is then erased. */
const MACHINE_TTL_SECONDS = 3 * 3_600;
/**
 * Groups whose medians measure this workstation's wall clock. Every other group may run on Boat:
 * lab groups count requests, payloads and renders, which repeat on any machine (CI gates on them),
 * layout groups check computed boxes, and visual groups render in the pinned Playwright image on
 * linux/amd64 (lib/testing/runner/visual-browser.ts). On a Boat `large` machine that image renders
 * the references as the workstation does: measured, at most 13 pixels an image differ, each by 1 of
 * 255, under the comparison's threshold (werk-flow/werkflow-planning#294).
 */
const WALL_CLOCK_GROUP = /^audit:performance/;
/**
 * Groups that cost this workstation less than a Boat run's fixed upload and setup, about 95 s of
 * machine time: a SQL group takes about 1 s against the shared stack, `unit:all` 60 to 90 s and a
 * static gate up to 35 s. Type-aware lint takes 170 to 370 s and 3 to 4 GB, the load Boat takes off.
 */
const CHEAP_HERE = /^(?:sql:|unit:all$|static:(?!lint$))/;
/**
 * Untracked files that may hold a credential or a local setting never leave the workstation: every
 * dotfile (`.env.*`, `.npmrc`, `.netrc`, `.git-credentials`, `.pgpass`), keys and certificates, and
 * names that say secret, credential, token or password.
 */
const SECRET_NAME =
  /(?:^|\/)(?:\.[^/]*|[^/]*\.(?:pem|key|p12|pfx|jks|keystore)|id_[a-z0-9]+|[^/]*(?:secret|credential|token|passw)[^/]*)$/i;
/** The files of a report that planning reads. */
const REPORT_FILES = ['report.json', 'diagnoses.json'];
/**
 * The top-level files of a browser run that planning reads: its manifest and its latency and lab
 * archives. A run's world state, traces and screenshots stay home; a cloud run's world holds DEV
 * passwords.
 */
const RUN_FILE = /^(?:manifest\.json|latency-summary\.json|[\w.-]+\.ndjson)$/;
const runTargetSchema = z.object({ target: z.string().optional() });
/**
 * The results download, after the run finished on a machine that is still alive: a dropped
 * connection gets three fresh attempts over about 40 s before the run falls back.
 */
const RESULTS_DOWNLOAD: TransferPolicy = { waits: [2_000, 10_000, 30_000], attemptMs: 300_000 };

/**
 * One upload's deadline and retry. A machine's file host accepts between 0.07 and 12 MB/s, so a
 * stalled attempt gives way to one fresh request after 30 s plus 1 s per 256 kB, instead of
 * holding a billed machine for minutes (werk-flow/werkflow-planning#294).
 */
function uploadPolicy(bytes: number): TransferPolicy {
  return { waits: [2_000], attemptMs: 1_000 * Math.ceil(30 + bytes / 256_000) };
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A Boat attempt's outcome: Boat's exit code, undefined when the plan belongs on this workstation
 * (CI, an explicit local run, a cheap or wall-clock plan), or Boat's unavailability.
 */
export type BoatOutcome = number | undefined | BoatUnavailable;

const say = (line: string) => console.info(`[verify] ${line}`);

/**
 * Why these arguments run locally: a reason to print, '' for a silent local run (CI, the Boat
 * machine itself), or undefined when Boat may run them.
 */
export function localReason(args: readonly string[], env: Environment): string | undefined {
  if (env.WERKFLOW_BOAT_MACHINE === '1' || env.CI === 'true') return '';
  if (env.WERKFLOW_VERIFY_LOCAL === '1') return 'WERKFLOW_VERIFY_LOCAL=1 asks for a local run.';
  const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (value('--target') === 'cloud')
    return 'the cloud canary reaches DEV, whose secrets stay on this workstation.';
  if (value('--mode') === 'release')
    return "release mode measures wall-clock groups against this machine's references.";
  if ((value('--group') ?? '').split(',').some((id) => WALL_CLOCK_GROUP.test(id)))
    return "the group measures this machine's wall clock.";
  return undefined;
}

/** The groups a printed plan runs. */
function plannedRuns(plan: string): string[] {
  return [...plan.matchAll(/^RUN +(\S+)/gm)].map((match) => match[1] ?? '');
}

/** The first group a printed plan runs that measures this workstation's wall clock. */
export function wallClockGroup(plan: string): string | undefined {
  return plannedRuns(plan).find((id) => WALL_CLOCK_GROUP.test(id));
}

/**
 * Why a printed plan costs less here than on Boat: it runs no group, or only cheap groups of which
 * at most one is not a SQL group. Undefined when Boat may run it.
 */
export function cheapPlanReason(plan: string): string | undefined {
  const runs = plannedRuns(plan);
  if (!runs.every((id) => CHEAP_HERE.test(id))) return undefined;
  const others = runs.filter((id) => !id.startsWith('sql:'));
  if (others.length > 1) return undefined;
  if (runs.length === 0) return 'the plan runs no group, which is cheaper here.';
  if (runs.length === 1) return `a single ${runs.join('')} is cheaper here.`;
  const sql = runs.length - others.length;
  return `${sql} SQL groups${others.length ? ` and ${others.join('')}` : ''} are cheaper here.`;
}

/**
 * Why a cheap plan runs here, or undefined when Boat may run it. A cheap plan that reads the shared
 * stack goes to Boat while that stack's migrations drift from this tree's, with one line naming the
 * drift: Boat starts a fresh stack at this tree's migrations, so the plan tests this tree's schema.
 */
export function cheapLocalReason(
  plan: string,
  readDrift: () => MigrationDrift | undefined,
): string | undefined {
  const cheap = cheapPlanReason(plan);
  if (!cheap || !readsSharedStack(plannedRuns(plan))) return cheap;
  const drift = driftLine(readDrift());
  if (!drift) return cheap;
  say(`${drift} Boat runs the plan on a fresh stack at this tree's migrations.`);
  return undefined;
}

/**
 * Whether a group stays blocked on this workstation when Boat is unavailable: every group but the
 * cheap ones and the wall-clock groups, which run here by design. Type-aware lint, `ui:contracts`
 * and every browser group: run here together, they overloaded the shared PC for hours.
 */
export function heldBackHere(id: string): boolean {
  return !CHEAP_HERE.test(id) && !WALL_CLOCK_GROUP.test(id);
}

/** The first untracked file that may hold a credential or a local setting, which Boat never gets. */
export function withheldFile(untracked: readonly string[]): string | undefined {
  return untracked.find((file) => SECRET_NAME.test(file));
}

/**
 * Why the plan these arguments select runs locally, from `test:plan` itself: a group that measures
 * this workstation's wall clock, a plan cheaper here than a Boat machine's setup, or a plan that
 * cannot be read. Undefined when Boat may run it.
 */
function planReason(repository: string, args: readonly string[]): string | undefined {
  const plan = spawnSync(process.execPath, ['scripts/verify.ts', 'plan', ...args], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (plan.status !== 0) return 'the plan could not be read here; the local run reports why.';
  const measured = wallClockGroup(plan.stdout);
  if (measured) return `the plan runs ${measured}, which measures this machine's wall clock.`;
  return cheapLocalReason(plan.stdout, () => readMigrationDrift(repository));
}

/**
 * The variables that point git at another repository (`git rev-parse --local-env-vars`): a git
 * child runs without them, so it reads the repository at its working folder.
 */
const GIT_LOCATION = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
]);

/** The process environment without the variables in GIT_LOCATION, for a git child. */
export function gitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of GIT_LOCATION) Reflect.deleteProperty(env, name);
  return env;
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: repository,
    env: gitEnvironment(),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Subfolder names of an evidence folder, or none when it does not exist. */
function folders(path: string): string[] {
  return existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
}

/** The evidence a plan reads, relative to `repository`: reports and diagnoses, and local runs' metadata. */
export function evidenceFiles(repository: string): string[] {
  const reports = folders(resolve(repository, '.agent-logs/verification')).flatMap((id) =>
    REPORT_FILES.map((name) => `.agent-logs/verification/${id}/${name}`),
  );
  const runs = folders(resolve(repository, '.agent-logs/playwright-runs')).flatMap((key) => {
    const run = `.agent-logs/playwright-runs/${key}`;
    const manifest = resolve(repository, run, 'manifest.json');
    if (!existsSync(manifest)) return [];
    let target: string | undefined;
    try {
      target = runTargetSchema.parse(JSON.parse(readFileSync(manifest, 'utf8'))).target;
    } catch {
      return [];
    }
    if (target !== 'local') return [];
    return readdirSync(resolve(repository, run), { withFileTypes: true })
      .filter((entry) => entry.isFile() && RUN_FILE.test(entry.name))
      .map((entry) => `${run}/${entry.name}`);
  });
  return [...reports, ...runs].filter((file) => existsSync(resolve(repository, file)));
}

/**
 * The paths git reads as changed since HEAD in `repository`: modified, deleted and untracked, each
 * side of a rename by its own name. Planning without a baseline report selects from them, so the
 * rebuilt checkout on the machine must give the same list (scripts/boat/check-tree.ts).
 */
export function changedSinceHead(repository: string): string[] {
  const list = (args: string[]) => git(repository, args).split('\0').filter(Boolean);
  const changed = list([
    '-c',
    'core.safecrlf=false',
    'diff',
    '--no-renames',
    '--name-only',
    '-z',
    'HEAD',
    '--',
  ]);
  return [...new Set([...changed, ...list(['ls-files', '--others', '--exclude-standard', '-z'])])].sort();
}

/**
 * The files the machine's checkout of HEAD lacks: those in `changed` that still exist. Only they
 * travel; the rest come from the checkout, which costs a slow upload nothing. That holds only when
 * every other tracked file has HEAD's bytes, mode and link target, so a file git reads as unchanged
 * although it differs (assume-unchanged, skip-worktree, core.filemode=false, a line-ending
 * conversion) is named instead: the machine would test HEAD's version of it.
 */
export function treeFiles(
  repository: string,
  changed: readonly string[],
): { files: string[] } | { hidden: string } {
  const listed = new Set(changed);
  const algorithm = git(repository, ['rev-parse', '--show-object-format']).trim();
  for (const entry of git(repository, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).split('\0')) {
    const [, mode, object, path] = /^(\d+) \w+ ([0-9a-f]+)\t([\s\S]+)$/.exec(entry) ?? [];
    if (!mode || !object || !path || listed.has(path) || mode === '160000') continue;
    const file = join(repository, path);
    let actual: { mode: string; bytes: Buffer };
    try {
      const stat = lstatSync(file);
      actual = stat.isSymbolicLink()
        ? { mode: '120000', bytes: Buffer.from(readlinkSync(file)) }
        : { mode: stat.mode & 0o100 ? '100755' : '100644', bytes: readFileSync(file) };
    } catch {
      return { hidden: path };
    }
    const digest = createHash(algorithm)
      .update(`blob ${actual.bytes.byteLength}\0`)
      .update(actual.bytes)
      .digest('hex');
    if (actual.mode !== mode || digest !== object) return { hidden: path };
  }
  return { files: changed.filter((file) => existsSync(resolve(repository, file))) };
}

/**
 * Why the machine's rebuilt checkout differs from the workstation's, naming the first paths each
 * side alone reads as changed; undefined when both read the same paths as changed.
 */
export function rebuiltTreeProblem(
  workstation: readonly string[],
  machine: readonly string[],
): string | undefined {
  const absent = (paths: readonly string[], from: readonly string[]) => {
    const present = new Set(from);
    return paths.filter((path) => !present.has(path));
  };
  const machineOnly = absent(machine, workstation);
  const workstationOnly = absent(workstation, machine);
  if (!machineOnly.length && !workstationOnly.length) return undefined;
  const named = (paths: readonly string[]) =>
    paths.length ? `${paths.length} (${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ', …' : ''})` : '0';
  return `git reads the rebuilt checkout as changed elsewhere than the workstation's: ${named(machineOnly)} paths only on the machine, ${named(workstationOnly)} only on the workstation.`;
}

/**
 * The arguments that pack the files named in `list` into `archive`, for the tar whose `--version`
 * printed `version`. macOS bsdtar adds each extended attribute as a pax keyword, which GNU tar on
 * the machine warns about, and an AppleDouble `._` member, which it unpacks as an untracked file.
 * GNU tar packs no extended attribute unless asked.
 */
export function tarPackArguments(version: string, archive: string, list: string): string[] {
  const metadata = version.startsWith('bsdtar ') ? ['--no-xattrs', '--no-mac-metadata'] : [];
  return ['-czf', archive, ...metadata, '--null', '-T', list];
}

/** Packs the local commits, the working tree's changes since HEAD and the evidence history into `folder`. */
function packRun(
  repository: string,
  folder: string,
): { head: string; bundle: boolean } | { refused: string } {
  const list = (args: string[]) => git(repository, args).split('\0').filter(Boolean);
  const untracked = list(['ls-files', '--others', '--exclude-standard', '-z']);
  const secret = withheldFile(untracked);
  if (secret)
    return {
      refused: `the untracked file ${secret} may hold a credential or a local setting, which Boat never gets.`,
    };
  const changed = changedSinceHead(repository);
  const tree = treeFiles(repository, changed);
  if ('hidden' in tree)
    return {
      refused: `git reads ${tree.hidden} as unchanged, but it differs from HEAD (assume-unchanged, skip-worktree, core.filemode or a line-ending conversion), so the machine would test HEAD's version.`,
    };
  const environment = resolve(repository, '.env.local');
  const supabaseUrl = existsSync(environment)
    ? parseEnvironmentFile(readFileSync(environment, 'utf8')).NEXT_PUBLIC_SUPABASE_URL
    : undefined;
  if (!backendIdentity(supabaseUrl, repository).startsWith('local:'))
    return { refused: '.env.local does not point at the local stack, which a Boat machine starts.' };
  // The machine proves this backend only when its stack matches it value by value (check-environment.ts).
  writeFileSync(join(folder, 'proof-environment'), proofEnvironmentDigest(repository));
  writeFileSync(join(folder, 'backend-values.json'), JSON.stringify(backendValueDigests(repository)));
  const head = git(repository, ['rev-parse', 'HEAD']).trim();
  let pushed = true;
  try {
    git(repository, ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  } catch {
    pushed = false;
  }
  if (!pushed) git(repository, ['bundle', 'create', join(folder, 'head.bundle'), 'HEAD', '^origin/main']);
  const exists = (file: string) => existsSync(resolve(repository, file));
  const version = execFileSync('tar', ['--version'], { encoding: 'utf8' });
  const tar = (name: string, files: readonly string[]) => {
    writeFileSync(join(folder, `${name}.list`), files.join('\0'));
    execFileSync(
      'tar',
      tarPackArguments(version, join(folder, `${name}.tgz`), join(folder, `${name}.list`)),
      {
        cwd: repository,
      },
    );
  };
  tar('tree', tree.files);
  // Against HEAD's tree, so a staged deletion or rename removes the old path on the machine too.
  const committed = list(['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
  writeFileSync(join(folder, 'deleted.txt'), committed.filter((file) => !exists(file)).join('\n'));
  writeFileSync(join(folder, 'changed.json'), JSON.stringify(changed));
  tar('evidence', evidenceFiles(repository));
  return { head, bundle: !pushed };
}

/**
 * An existing symbolic link in the checkout that a copy to one of `paths` would write through, or
 * undefined. Each path is checked component by component, from `.agent-logs` down to the file.
 */
export function linkedDestination(repository: string, paths: readonly string[]): string | undefined {
  const prefixes = new Set(
    paths.flatMap((path) => {
      const parts = path.split('/').filter(Boolean);
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    }),
  );
  for (const prefix of [...prefixes].sort()) {
    let link = false;
    try {
      link = lstatSync(join(repository, prefix)).isSymbolicLink();
    } catch {
      continue;
    }
    if (link) return `${prefix} is a symbolic link in the checkout.`;
  }
  return undefined;
}

/**
 * Honors a Ctrl-C that arrived during synchronous work. Bun runs a signal handler only once the
 * event loop turns; measured, not after a microtask but after setImmediate. So a check right after
 * a synchronous step would miss it and fall back to a local run.
 */
async function honorInterrupt(signal: AbortSignal): Promise<void> {
  await new Promise((done) => setImmediate(done));
  signal.throwIfAborted();
}

/** Boat's unavailability after a failure; an interruption by the user is rethrown, never a fallback. */
export function unavailable(error: unknown, signal: AbortSignal): BoatUnavailable {
  if (signal.aborted) throw error;
  return { unavailable: boatFailure(error) };
}

/** A Boat refusal in one line, with the renewal advice when Boat rejected the key itself. */
export function boatFailure(error: unknown): string {
  if (error instanceof BoatError && (error.status === 401 || error.code.startsWith('api_key_')))
    return `Boat rejected the key (${error.code}). ${RENEW_ADVICE}`;
  if (error instanceof BoatError) return `Boat answered ${error.status} ${error.code}.`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `test:verify <args>` on Boat and answers its exit code, undefined when the run belongs on
 * this workstation, or Boat's unavailability: no key, an unusable key, or any Boat failure before
 * the results are back. `readKey` is a test's stand-in.
 */
export async function verifyOnBoat(
  args: readonly string[],
  repository: string,
  env: Environment = process.env,
  readKey: () => BoatKeyReading = readBoatKey,
): Promise<BoatOutcome> {
  return withBoatKey(localReason(args, env), readKey, (key, signal) =>
    prepareAndRun(args, repository, key, signal),
  );
}

export async function prepareAndRun(
  args: readonly string[],
  repository: string,
  key: string,
  signal: AbortSignal,
): Promise<BoatOutcome> {
  const planned = planReason(repository, args);
  await honorInterrupt(signal);
  if (planned) {
    say(`Running locally: ${planned}`);
    return undefined;
  }
  return withRunFolder(repository, signal, 'verification on Boat', (folder) =>
    runOnBoat({ args, repository, folder, key, signal }),
  );
}

/**
 * Runs `work` with a fresh folder for the packed run and its results, under the workspace test
 * lock, so the edit guard works as during a local run. The folder is removed afterwards.
 */
export async function withRunFolder(
  repository: string,
  signal: AbortSignal,
  operation: string,
  work: (folder: string) => Promise<BoatOutcome>,
): Promise<BoatOutcome> {
  let folder: string;
  try {
    mkdirSync(join(homedir(), '.cache'), { recursive: true });
    folder = mkdtempSync(join(homedir(), '.cache', 'werkflow-boat-'));
  } catch (error) {
    return unavailable(error, signal);
  }
  try {
    return await withWorkspaceTestLock({ operation, repositoryRoot: repository }, () => work(folder));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Uploads the packed run and the script that runs it to the machine's home folder. */
async function uploadRun(
  machine: Machine,
  run: { repository: string; folder: string; bundle: boolean },
  context: TransferContext,
): Promise<void> {
  const { repository, folder, bundle } = run;
  const files: [string, string][] = [
    ...['tree.tgz', 'evidence.tgz', 'deleted.txt', 'changed.json', 'proof-environment', 'backend-values.json']
      .concat(bundle ? ['head.bundle'] : [])
      .map((name): [string, string] => [name, join(folder, name)]),
    ['remote-verify.sh', resolve(repository, 'scripts/boat/remote-verify.sh')],
  ];
  const started = Date.now();
  let total = 0;
  for (const [name, source] of files) {
    const bytes = readFileSync(source);
    total += bytes.byteLength;
    await transfer(`The upload of ${name}`, uploadPolicy(bytes.byteLength), context, (signal) =>
      machine.client.upload(machine.id, `${HOME}/${name}`, bytes, signal),
    );
  }
  say(
    `Uploaded the run (${(total / 1e6).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

/** The longest file name, and the longest path (the platform's PATH_MAX less one), a copy may write. */
const MAX_NAME_BYTES = 255;
const MAX_PATH_BYTES = process.platform === 'darwin' ? 1023 : 4095;

/** A name the guard does not copy: a control character, a backslash or a newline. */
const UNSAFE_NAME = /[\u0000-\u001f\u007f\\]/;

/**
 * Copies the regular files of an unpacked results folder into the checkout's `.agent-logs/`. The
 * unpacked tree is walked with lstat semantics, never read from a tar listing: anything at its top
 * but `.agent-logs`, a symbolic link, a hard link, a device or other special file, or a name with a
 * control character, backslash or newline refuses the whole import. Every destination is then
 * checked before the first copy, so no existing symbolic link is written through and a refusal
 * writes nothing.
 */
export function copyResults(staging: string, repository: string): void {
  const outside = readdirSync(staging).find((name) => name !== '.agent-logs');
  if (outside !== undefined) throw new Error(`${JSON.stringify(outside)} lies outside .agent-logs/.`);
  const source = join(staging, '.agent-logs');
  if (!existsSync(source)) return;
  if (!lstatSync(source).isDirectory()) throw new Error('.agent-logs is not a folder.');
  const files: string[] = [];
  for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
    const full = join(entry.parentPath, entry.name);
    const path = relative(staging, full);
    if (UNSAFE_NAME.test(entry.name)) throw new Error(`${JSON.stringify(path)} has an unsafe name.`);
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) throw new Error(`${JSON.stringify(path)} is not a regular file.`);
    if (lstatSync(full).nlink > 1) throw new Error(`${JSON.stringify(path)} is a hard link.`);
    files.push(path);
  }
  const linked = linkedDestination(repository, files) ?? destinationConflict(repository, files);
  if (linked) throw new Error(linked);
  placeFiles(staging, repository, files);
}

/**
 * Why a destination cannot take a copy, or undefined: a folder on its way that exists but is not a
 * folder, or an existing destination that is not a regular file or is a hard link, whose other names
 * a copy would change too. Checked for every file before the first write.
 */
function destinationConflict(repository: string, files: readonly string[]): string | undefined {
  for (const path of files) {
    const parts = path.split('/');
    const target = join(repository, path);
    if (
      parts.some((part) => Buffer.byteLength(part) > MAX_NAME_BYTES) ||
      Buffer.byteLength(target) > MAX_PATH_BYTES
    )
      return `${JSON.stringify(path)} is too long for a path in the checkout.`;
    for (let index = 1; index < parts.length; index++) {
      const folder = join(repository, ...parts.slice(0, index));
      if (existsSync(folder) && !lstatSync(folder).isDirectory())
        return `${JSON.stringify(parts.slice(0, index).join('/'))} is not a folder in the checkout.`;
    }
    if (!existsSync(target)) continue;
    const stat = lstatSync(target);
    if (!stat.isFile()) return `${JSON.stringify(path)} exists in the checkout and is not a regular file.`;
    if (stat.nlink > 1) return `${JSON.stringify(path)} is a hard link in the checkout.`;
  }
  return undefined;
}

/**
 * Writes every file to a temporary name beside its destination, then renames each into place, so
 * no existing file is written through. Any failure, while writing or while renaming, restores the
 * checkout: installed files are removed, replaced files come back from their backup, and every
 * temporary file and created folder is removed. `rename` is a test's stand-in.
 */
export function placeFiles(
  staging: string,
  repository: string,
  files: readonly string[],
  rename: (from: string, to: string) => void = renameSync,
): void {
  const created: string[] = [];
  const temporary: [string, string][] = [];
  const placed: { target: string; backup: string | undefined }[] = [];
  try {
    for (const path of files) {
      const target = join(repository, path);
      const parts = path.split('/');
      for (let index = 1; index < parts.length; index++) {
        const folder = join(repository, ...parts.slice(0, index));
        if (existsSync(folder)) continue;
        mkdirSync(folder);
        created.push(folder);
      }
      const temp = join(dirname(target), `.boat-import-${randomUUID()}`);
      copyFileSync(join(staging, path), temp);
      temporary.push([temp, target]);
    }
    for (const [temp, target] of temporary) {
      const backup = existsSync(target) ? `${temp}.previous` : undefined;
      if (backup) rename(target, backup);
      placed.push({ target, backup });
      rename(temp, target);
    }
  } catch (error) {
    for (const { target, backup } of placed.reverse()) {
      if (backup === undefined) rmSync(target, { force: true });
      else if (existsSync(backup)) renameSync(backup, target);
    }
    for (const [temp] of temporary) rmSync(temp, { force: true });
    for (const folder of created.reverse()) rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  for (const { backup } of placed) if (backup) rmSync(backup, { force: true });
}

/**
 * Unpacks a results archive into `staging`, a fresh folder outside the checkout, and copies its
 * regular files into the checkout. Any refusal writes nothing into the checkout.
 */
export function unpackResults(archive: string, staging: string, repository: string): void {
  try {
    execFileSync('tar', ['-xzf', archive, '-C', staging, '--no-same-owner', '--no-same-permissions'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    copyResults(staging, repository);
  } catch (error) {
    throw new Error(
      `The Boat results archive was refused: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
  }
}

/**
 * Downloads the run's results, retrying a failed download on a fresh request, and unpacks them
 * through a fresh folder outside the checkout.
 */
export async function importResults(
  machine: Machine,
  run: { folder: string; repository: string },
  context: TransferContext,
): Promise<void> {
  const { folder, repository } = run;
  const archive = join(folder, 'results.tgz');
  const bytes = await transfer('The results download', RESULTS_DOWNLOAD, context, (signal) =>
    machine.client.download(machine.id, `${HOME}/results.tgz`, signal),
  );
  writeFileSync(archive, bytes);
  const staging = mkdtempSync(join(folder, 'results-'));
  try {
    unpackResults(archive, staging, repository);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Runs `work` on a started machine, then reports its cost and deletes it, whatever `work` did. A
 * Ctrl-C during that cleanup still stops the run: no fallback to a local run follows an interruption.
 */
export async function withMachine<T>(
  machine: Machine,
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } finally {
    const usage = await machineUsage(machine);
    await deleteMachine(machine);
    say(
      `Boat machine ${machine.id} deleted${usage ? `: ${Math.round(usage.seconds / 2)} s of large, $${usage.dollars.toFixed(4)}` : ''}.`,
    );
  }
  signal.throwIfAborted();
  return result;
}

export async function runOnBoat(input: {
  args: readonly string[];
  repository: string;
  folder: string;
  key: string;
  signal: AbortSignal;
}): Promise<BoatOutcome> {
  const { args, repository, folder, signal } = input;
  const before = captureInputSnapshot(repository);
  let packed: ReturnType<typeof packRun>;
  try {
    packed = packRun(repository, folder);
  } catch (error) {
    packed = { refused: `packing the run failed: ${boatFailure(error)}` };
  }
  await honorInterrupt(signal);
  if ('refused' in packed) return { unavailable: packed.refused };
  const client = retryingStart(boatClient(input.key), { signal, log: say });
  const started = Date.now();
  let machine: Machine;
  try {
    machine = await createMachine(client, {
      from: SNAPSHOT_NAME,
      name: `verify-${repository.split('/').at(-1) ?? 'checkout'}`,
      ttlSeconds: MACHINE_TTL_SECONDS,
      purpose: 'run',
      log: say,
      signal,
    });
  } catch (error) {
    return unavailable(error, signal);
  }
  say(
    `Running on Boat machine ${machine.id} (large), ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  return withMachine(machine, signal, async (): Promise<BoatOutcome> => {
    let code: number;
    try {
      signal.throwIfAborted();
      await uploadRun(machine, { repository, folder, bundle: packed.bundle }, { signal, log: say });
      signal.throwIfAborted();
      const form = lstatSync(join(repository, '.git')).isFile() ? 'linked' : 'main';
      const command = ['bash', '~/remote-verify.sh', repository, packed.head, form, ...args].map(
        (word, index) => (index === 1 ? word : shellQuote(word)),
      );
      const result = await runScript(
        machine,
        command.join(' '),
        { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
        signal,
      );
      if (result.exitCode === SETUP_FAILED || result.oomKilled)
        return {
          unavailable: `the Boat machine ${result.oomKilled ? 'ran out of memory' : 'failed to set up'}.`,
        };
      await importResults(machine, { folder, repository }, { signal, log: say });
      // The machine pruned only its copy of the archive; the workstation's shrinks as after a local run.
      console.info(pruneRunArchive('prune'));
      code = result.exitCode;
      if (changedInputs(before, captureInputSnapshot(repository)).length) {
        console.error('Inputs changed during verification; this report cannot qualify acceptance.');
        code = 1;
      }
      return code;
    } catch (error) {
      return unavailable(error, signal);
    }
  });
}
