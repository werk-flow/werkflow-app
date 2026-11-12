import { readBoatKey, withBoatKey, type BoatKeyReading } from './boat-key';
import { shellQuote } from './boat-machine';
import { type BoatOutcome, runOnBoat, withRunFolder } from './verify-on-boat';

// A rendered acceptance capture, `bun run test:audit:focused --grep "@ACCEPT <set>"`, runs on a Boat
// machine when this workstation has a Boat key (docs/technical/boat-verification.md, "Captures on
// Boat"). Locally it needs a production build and its server beside the stack and a browser; on
// 2026-11-09 one such capture was among the largest loads on the shared PC. The machine serves the
// build itself and runs the same command on the same tree, and the run folder with its images comes
// back to the same path. When Boat is unavailable, the capture does not run here unless
// WERKFLOW_VERIFY_LOCAL=1 asks for it.

type Environment = Readonly<Record<string, string | undefined>>;

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

/** Whether `bun scripts/run-playwright.ts <argv>` is a focused acceptance capture. */
export function isAcceptanceCapture(argv: readonly string[]): boolean {
  const [lane, suite, ...args] = argv;
  return lane === 'iteration' && suite === 'audit' && ACCEPTANCE_GREP.test(option(args, '--grep') ?? '');
}

/**
 * Why a capture with these runner arguments runs here: a reason to print, '' for a silent local run
 * (CI, the Boat machine itself), or undefined when Boat may run it.
 */
export function captureLocalReason(args: readonly string[], env: Environment): string | undefined {
  if (env.WERKFLOW_BOAT_MACHINE === '1' || env.CI === 'true') return '';
  if (env.WERKFLOW_VERIFY_LOCAL === '1') return 'WERKFLOW_VERIFY_LOCAL=1 asks for a local run.';
  if (option(args, '--reuse-run')) return "a retained world lives on this workstation's stack.";
  if (option(args, '--target') === 'cloud')
    return 'a cloud capture reaches DEV, whose secrets stay on this workstation.';
  return undefined;
}

/**
 * Runs the focused capture `test:audit:focused <args>` on Boat and answers its exit code, undefined
 * when it belongs on this workstation, or Boat's unavailability. `readKey` is a test's stand-in.
 */
export async function captureOnBoat(
  args: readonly string[],
  repository: string,
  env: Environment = process.env,
  readKey: () => BoatKeyReading = readBoatKey,
): Promise<BoatOutcome> {
  return withBoatKey(captureLocalReason(args, env), readKey, (key, signal) =>
    withRunFolder(repository, signal, 'capture on Boat', (folder) =>
      runOnBoat({ args: ['test:audit:focused', ...args], repository, folder, key, signal }),
    ),
  );
}

/**
 * The notice a capture prints when Boat is unavailable and it does not run: why, what a local
 * capture costs, and how to run it here deliberately with `args`.
 */
export function captureUnavailableNotice(reason: string, args: readonly string[]): string[] {
  const rule = '='.repeat(72);
  return [
    rule,
    `BOAT IS UNAVAILABLE: ${reason}`,
    'The capture does NOT run here: it needs a production build at up to 2.9 GiB, its server,',
    'the stack and a browser on this workstation. No image was written; this command exits 1.',
    'Run again later to use Boat, or capture here deliberately, with the server in a second shell:',
    '  bun run test:server local',
    `  WERKFLOW_VERIFY_LOCAL=1 bun run test:audit:focused ${args.map(shellQuote).join(' ')}`,
    rule,
  ];
}
