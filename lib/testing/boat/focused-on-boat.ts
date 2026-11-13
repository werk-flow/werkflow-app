import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type MigrationDrift, driftLine, readMigrationDrift } from '../local-stack/migration-drift';
import { VISUAL_REFERENCE_UPDATE_ENV } from '../runner/visual-reference-updates';
import { readBoatKey, withBoatKey, type BoatKeyReading } from './boat-key';
import { shellQuote } from './boat-machine';
import { REFERENCE_UPDATES, applyReferenceUpdates, referenceHashes } from './reference-updates';
import { type BoatOutcome, runOnBoat, withRunFolder } from './verify-on-boat';

// A focused browser run, `bun run test:audit:focused` or `test:golden:focused`, runs on a Boat
// machine when this workstation has a Boat key and the run needs the app built at this tree's
// migrations (docs/technical/boat-verification.md, "Focused runs on Boat"):
// - a rendered acceptance capture (`--grep "@ACCEPT <set>"`) always, since locally it needs a
//   production build and its server, one of the largest loads on the shared PC;
// - a visual reference update (WERKFLOW_UPDATE_VISUAL_REFERENCES=1) always, for the same reason;
//   the references it rewrote come back into the checkout (reference-updates.ts);
// - any other focused run when the tree's migrations differ from the shared stack's, as
//   `test:verify` decides (migration-drift.ts): the test server refuses that stack here.
// The machine serves the build itself, runs the same command on the same tree, and the run folder
// comes back to the same path. When Boat is unavailable, nothing runs here unless
// WERKFLOW_VERIFY_LOCAL=1 asks for it.

type Environment = Readonly<Record<string, string | undefined>>;

/** What Boat may run: a capture, a reference update, or another focused run. */
export type FocusedKind = 'capture' | 'reference-update' | 'focused';

/** A focused run's grep that selects rendered acceptance captures (tests/audit/visual/acceptance-*.spec.ts). */
const ACCEPTANCE_GREP = /^@ACCEPT(?:\s|$)/;

/** The value of `--name value` or `--name=value` in runner arguments. */
function option(args: readonly string[], name: string): string | undefined {
  for (const [index, argument] of args.entries()) {
    if (argument === name) return args[index + 1];
    if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
  }
  return undefined;
}

/** The kind of focused run `bun scripts/run-playwright.ts <argv>` is, or undefined for any other run. */
export function focusedKind(argv: readonly string[], env: Environment): FocusedKind | undefined {
  const [lane, suite, ...args] = argv;
  if (lane !== 'iteration' || (suite !== 'audit' && suite !== 'golden')) return undefined;
  if (suite !== 'audit') return 'focused';
  if (ACCEPTANCE_GREP.test(option(args, '--grep') ?? '')) return 'capture';
  return env[VISUAL_REFERENCE_UPDATE_ENV] === '1' ? 'reference-update' : 'focused';
}

/**
 * Why a focused run with these runner arguments runs here: a reason to print, '' for a silent local
 * run (CI, the Boat machine itself), or undefined when Boat may run it.
 */
export function focusedLocalReason(args: readonly string[], env: Environment): string | undefined {
  if (env.WERKFLOW_BOAT_MACHINE === '1' || env.CI === 'true') return '';
  if (env.WERKFLOW_VERIFY_LOCAL === '1') return 'WERKFLOW_VERIFY_LOCAL=1 asks for a local run.';
  if (option(args, '--reuse-run')) return "a retained world lives on this workstation's stack.";
  if (option(args, '--target') === 'cloud')
    return 'a cloud run reaches DEV, whose secrets stay on this workstation.';
  return undefined;
}

/** The update folders the evidence holds now. */
function updateFolders(repository: string): Set<string> {
  const folder = join(repository, REFERENCE_UPDATES);
  return new Set(existsSync(folder) ? readdirSync(folder) : []);
}

/**
 * Places the references a Boat update rewrote, from the update folders that came back, and prints
 * them with the next steps. A refused set writes nothing and turns the run's exit code into 1. A
 * reference changed here since `before.references`, taken when the run started, keeps its local
 * version, is named with Boat's copy, and also turns the exit code into 1.
 */
export function placeReferenceUpdates(
  repository: string,
  before: { folders: ReadonlySet<string>; references: ReadonlyMap<string, string> },
  code: number,
): number {
  let placed: string[] = [];
  let kept: string[] = [];
  try {
    for (const name of [...updateFolders(repository)].filter((found) => !before.folders.has(found))) {
      const folder = join(repository, REFERENCE_UPDATES, name);
      const result = applyReferenceUpdates(repository, folder, before.references);
      placed = [...placed, ...result.placed];
      kept = [
        ...kept,
        ...result.kept.map((path) => `${path} (Boat's copy: ${join(REFERENCE_UPDATES, name, path)})`),
      ];
    }
  } catch (error) {
    console.error(`[verify] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  console.info(
    placed.length
      ? `[verify] The update rewrote or wrote ${placed.length} visual references in this checkout:\n${placed.map((path) => `  ${path}`).join('\n')}\n[verify] Next: look at every changed image, restore each one the accepted change does not explain with git checkout -- <file>, then run bun run test:verify --group audit:visual.`
      : '[verify] The update rewrote no visual reference.',
  );
  if (!kept.length) return code;
  // A reference changed here while the run went keeps this checkout's version: never lost to Boat's.
  console.error(
    `[verify] ${kept.length} references changed in this checkout during the run kept their local version:\n${kept.map((path) => `  ${path}`).join('\n')}`,
  );
  return 1;
}

/**
 * Runs `bun scripts/run-playwright.ts <argv>` on Boat when its kind and the migration drift call
 * for it, and answers its exit code, undefined when it runs here, or Boat's unavailability.
 * `readKey` and `readDrift` are a test's stand-ins.
 */
export async function focusedOnBoat(
  argv: readonly string[],
  repository: string,
  env: Environment = process.env,
  readKey: () => BoatKeyReading = readBoatKey,
  readDrift: () => MigrationDrift | undefined = () => readMigrationDrift(repository),
): Promise<BoatOutcome> {
  const kind = focusedKind(argv, env);
  const [, suite, ...args] = argv;
  if (!kind) return undefined;
  const reason = focusedLocalReason(args, env);
  if (kind === 'focused') {
    // An ordinary focused run stays here, silently as ever, unless the shared stack lacks this tree's migrations.
    if (reason !== undefined) return undefined;
    const drift = driftLine(readDrift());
    if (!drift) return undefined;
    console.info(`[verify] ${drift} Boat runs this focused run on a fresh stack at this tree's migrations.`);
  }
  const script = kind === 'reference-update' ? 'test:audit:update-references' : `test:${suite}:focused`;
  return withBoatKey(reason, readKey, (key, signal) => {
    const folders = updateFolders(repository);
    // The references change inside the workspace lock the run holds, so no other test operation
    // starts between the run and the files it rewrote.
    return withRunFolder(repository, signal, `focused run on Boat`, async (folder) => {
      const before = { folders, references: referenceHashes(repository) };
      const outcome = await runOnBoat({ args: [script, ...args], repository, folder, key, signal });
      return kind === 'reference-update' && typeof outcome === 'number'
        ? placeReferenceUpdates(repository, before, outcome)
        : outcome;
    });
  });
}

/**
 * The notice a focused run prints when Boat is unavailable and it does not run: why, what a local
 * run costs, and how to run it here deliberately.
 */
export function focusedUnavailableNotice(
  reason: string,
  argv: readonly string[],
  env: Environment,
): string[] {
  const [, suite, ...args] = argv;
  const update = focusedKind(argv, env) === 'reference-update' ? `${VISUAL_REFERENCE_UPDATE_ENV}=1 ` : '';
  const rule = '='.repeat(72);
  return [
    rule,
    `BOAT IS UNAVAILABLE: ${reason}`,
    'The focused run does NOT run here: it needs a production build at up to 2.9 GiB, its server,',
    "the stack at this tree's migrations and a browser. Nothing was written; this command exits 1.",
    'Run again later to use Boat, or run it here deliberately, with the server in a second shell:',
    '  bun run test:server local',
    `  WERKFLOW_VERIFY_LOCAL=1 ${update}bun run test:${suite ?? 'audit'}:focused ${args.map(shellQuote).join(' ')}`,
    rule,
  ];
}
