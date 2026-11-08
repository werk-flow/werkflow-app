import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../../zod';

import { captureInputSnapshot, changedInputs } from '../evidence/group-evidence';
import {
  backendIdentity,
  backendValueDigests,
  parseEnvironmentFile,
  proofEnvironmentDigest,
} from '../evidence/proof-environment';
import { withWorkspaceTestLock } from '../runner/workspace-test-lock';
import { pruneRunArchive } from '../runs/run-retention';
import { BoatError, boatClient } from './boat-api';
import { RENEW_ADVICE, readBoatKey } from './boat-key';
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
// come back as a local run writes them. Any Boat failure falls back to the local run.

/** The saved snapshot every verification machine starts from (scripts/boat/build-snapshot.ts). */
export const SNAPSHOT_NAME = 'werkflow-verify';
/** The machine's home folder, where a run's files go. */
const HOME = '/home/user';
/** remote-verify.sh's exit code when setup failed before test:verify started. */
const SETUP_FAILED = 90;
/** A hard stop for a machine whose run or deletion went wrong; without snapshots it is then erased. */
const MACHINE_TTL_SECONDS = 3 * 3_600;
/** Groups that measure the machine or compare screenshots, against references taken on the workstation. */
const MACHINE_BOUND_GROUP = /^audit:(?:lab|performance|visual|layout)/;
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

type Environment = Readonly<Record<string, string | undefined>>;

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
  if ((value('--group') ?? '').split(',').some((id) => MACHINE_BOUND_GROUP.test(id)))
    return "the group measures or captures against this machine's references.";
  return undefined;
}

/** The first group a printed plan runs that measures or captures against the workstation. */
export function machineBoundGroup(plan: string): string | undefined {
  return [...plan.matchAll(/^RUN +(\S+)/gm)]
    .map((match) => match[1] ?? '')
    .find((id) => MACHINE_BOUND_GROUP.test(id));
}

/** The first untracked file that may hold a credential or a local setting, which Boat never gets. */
export function withheldFile(untracked: readonly string[]): string | undefined {
  return untracked.find((file) => SECRET_NAME.test(file));
}

/**
 * Why the plan these arguments select runs locally, from `test:plan` itself: a group that measures
 * or captures against the workstation, or a plan that cannot be read. Undefined when Boat may run it.
 */
function planReason(repository: string, args: readonly string[]): string | undefined {
  const plan = spawnSync(process.execPath, ['scripts/verify.ts', 'plan', ...args], {
    cwd: repository,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (plan.status !== 0) return 'the plan could not be read here; the local run reports why.';
  const bound = machineBoundGroup(plan.stdout);
  return bound
    ? `the plan runs ${bound}, which measures or captures against this machine's references.`
    : undefined;
}

function git(repository: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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

/** Packs the local commits, the working tree and the evidence history into `folder`. */
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
  const tracked = list(['ls-files', '-z']);
  const exists = (file: string) => existsSync(resolve(repository, file));
  const tar = (name: string, files: readonly string[]) => {
    writeFileSync(join(folder, `${name}.list`), files.join('\0'));
    execFileSync('tar', ['-czf', join(folder, `${name}.tgz`), '--null', '-T', join(folder, `${name}.list`)], {
      cwd: repository,
    });
  };
  tar('tree', [...tracked, ...untracked].filter(exists));
  // Against HEAD's tree, so a staged deletion or rename removes the old path on the machine too.
  const committed = list(['ls-tree', '-r', '-z', '--name-only', 'HEAD']);
  writeFileSync(join(folder, 'deleted.txt'), committed.filter((file) => !exists(file)).join('\n'));
  tar('evidence', evidenceFiles(repository));
  return { head, bundle: !pushed };
}

/** A Boat refusal in one line, with the renewal advice when Boat rejected the key itself. */
export function boatFailure(error: unknown): string {
  if (error instanceof BoatError && (error.status === 401 || error.code.startsWith('api_key_')))
    return `Boat rejected the key (${error.code}). ${RENEW_ADVICE}`;
  if (error instanceof BoatError) return `Boat answered ${error.status} ${error.code}.`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `test:verify <args>` on Boat and answers its exit code, or undefined when the run belongs
 * on this workstation: no key, a local reason, or any Boat failure before the run started.
 */
export async function verifyOnBoat(
  args: readonly string[],
  repository: string,
  env: Environment = process.env,
): Promise<number | undefined> {
  const reason = localReason(args, env);
  if (reason !== undefined) {
    if (reason) say(`Running locally: ${reason}`);
    return undefined;
  }
  const key = readBoatKey();
  if (key.kind === 'absent') return undefined;
  if (key.kind === 'unusable') {
    say(`Running locally: ${key.reason}`);
    return undefined;
  }
  if (key.reminder) say(key.reminder);
  const planned = planReason(repository, args);
  if (planned) {
    say(`Running locally: ${planned}`);
    return undefined;
  }
  let folder: string;
  try {
    mkdirSync(join(homedir(), '.cache'), { recursive: true });
    folder = mkdtempSync(join(homedir(), '.cache', 'werkflow-boat-'));
  } catch (error) {
    say(`Running locally: ${boatFailure(error)}`);
    return undefined;
  }
  const interrupt = new AbortController();
  const stop = () => interrupt.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    return await withWorkspaceTestLock(
      { operation: 'verification on Boat', repositoryRoot: repository },
      () => runOnBoat({ args, repository, folder, key: key.key, signal: interrupt.signal }),
    );
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Uploads the packed run and the script that runs it to the machine's home folder. */
async function uploadRun(
  machine: Machine,
  repository: string,
  folder: string,
  bundle: boolean,
): Promise<void> {
  const files: [string, string][] = [
    ...['tree.tgz', 'evidence.tgz', 'deleted.txt', 'proof-environment', 'backend-values.json']
      .concat(bundle ? ['head.bundle'] : [])
      .map((name): [string, string] => [name, join(folder, name)]),
    ['remote-verify.sh', resolve(repository, 'scripts/boat/remote-verify.sh')],
  ];
  for (const [name, source] of files)
    await machine.client.upload(machine.id, `${HOME}/${name}`, readFileSync(source));
}

async function runOnBoat(input: {
  args: readonly string[];
  repository: string;
  folder: string;
  key: string;
  signal: AbortSignal;
}): Promise<number | undefined> {
  const { args, repository, folder, signal } = input;
  const before = captureInputSnapshot(repository);
  let packed: ReturnType<typeof packRun>;
  try {
    packed = packRun(repository, folder);
  } catch (error) {
    packed = { refused: `packing the run failed: ${boatFailure(error)}` };
  }
  if ('refused' in packed) {
    say(`Running locally: ${packed.refused}`);
    return undefined;
  }
  const client = boatClient(input.key);
  const started = Date.now();
  let machine: Machine;
  try {
    machine = await createMachine(client, {
      from: SNAPSHOT_NAME,
      name: `verify-${repository.split('/').at(-1) ?? 'checkout'}`,
      ttlSeconds: MACHINE_TTL_SECONDS,
      snapshots: false,
      log: say,
    });
  } catch (error) {
    say(`Running locally: ${boatFailure(error)}`);
    return undefined;
  }
  say(
    `Running on Boat machine ${machine.id} (large), ready in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
  let code: number | undefined;
  try {
    await uploadRun(machine, repository, folder, packed.bundle);
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
    if (result.exitCode === SETUP_FAILED || result.oomKilled) {
      say(
        `Running locally: the Boat machine ${result.oomKilled ? 'ran out of memory' : 'failed to set up'}.`,
      );
      return undefined;
    }
    const results = await client.download(machine.id, `${HOME}/results.tgz`);
    writeFileSync(join(folder, 'results.tgz'), results);
    execFileSync('tar', ['-xzf', join(folder, 'results.tgz')], { cwd: repository });
    // The machine pruned only its copy of the archive; the workstation's shrinks as after a local run.
    console.info(pruneRunArchive('prune'));
    code = result.exitCode;
    if (changedInputs(before, captureInputSnapshot(repository)).length) {
      console.error('Inputs changed during verification; this report cannot qualify acceptance.');
      code = 1;
    }
    return code;
  } catch (error) {
    if (signal.aborted) throw error;
    say(`Running locally: ${boatFailure(error)}`);
    return undefined;
  } finally {
    const usage = await machineUsage(machine);
    await deleteMachine(machine);
    say(
      `Boat machine ${machine.id} deleted${usage ? `: ${Math.round(usage.seconds / 2)} s of large, $${usage.dollars.toFixed(4)}` : ''}.`,
    );
  }
}
