import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitEnvironment } from '../lib/testing/boat/verify-on-boat';
import { type MigrationDrift, readMigrationDrift } from '../lib/testing/local-stack/migration-drift';
import {
  GUARD_QUERY,
  GUARD_SQL,
  RESET_CONFIRMATION,
  RESET_WARNING,
  SYNC_OPTIONS,
  resetRefusal,
  syncDecision,
} from '../lib/testing/local-stack/stack-sync';
import { CHANGED_CHECK_BASE } from '../lib/testing/runner/changed-check';
import { StackHeldError, withStackLock } from '../lib/testing/runner/stack-lock';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

// `bun run stack:sync` and `bun run stack:reset`: the two commands that write the migration ledger
// of the local stack every worktree shares (lib/testing/local-stack/stack-sync.ts). Both apply
// origin/main's migrations, exported from git, never this checkout's, so any worktree on any
// branch brings the stack to the same state.
//
//   sync [--no-wait]   installs the ledger trigger, applies main's pending migrations under the
//                      exclusive stack lock, and exits 1 when the stack holds anything main lacks.
//                      `check:changed` and the worktree setup run it with --no-wait, which leaves
//                      pending migrations for the next sync while a run holds the stack.
//   reset --destroy-test-data
//                      rebuilds the database from main's migrations. Refused while any run holds
//                      the stack.

const repositoryRoot = resolve(import.meta.dir, '..');
const DATABASE = 'supabase_db_werkflow-app';
const EDGE_RUNTIME = 'supabase_edge_runtime_werkflow-app';
const say = (line: string) => console.info(`[stack] ${line}`);

const [action, ...flags] = process.argv.slice(2);
const known = action === 'sync' ? ['--no-wait'] : action === 'reset' ? [RESET_CONFIRMATION] : undefined;
if (!known || flags.some((flag) => !known.includes(flag))) {
  console.error(`Usage: bun scripts/local-stack.ts sync [--no-wait] | reset ${RESET_CONFIRMATION}`);
  process.exit(1);
}
// CI and a Boat machine start their own stack at the tree's migrations; it is nobody else's.
if (process.env.CI === 'true' || process.env.WERKFLOW_BOAT_MACHINE === '1') {
  say("This machine's stack is its own run's, at the tree's migrations; nothing to do.");
  process.exit(0);
}

/** A git call in this checkout; a fetch that hangs on a dead network ends after 30 s, and none prompts. */
function git(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync('git', args, {
    cwd: repositoryRoot,
    env: { ...gitEnvironment(), GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 512 * 1024 * 1024,
    timeout: 30_000,
  });
}

/** Runs SQL in the stack's database as the CLI's own role; undefined when the stack cannot be reached. */
function sql(text: string, options?: string, quiet = false): string | undefined {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      ...(options ? ['-e', `PGOPTIONS=${options}`] : []),
      DATABASE,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
    ],
    { input: text, encoding: 'utf8', timeout: 60_000 },
  );
  if (result.status !== 0) {
    if (!quiet && result.stderr.trim()) console.error(result.stderr.trim());
    return undefined;
  }
  return result.stdout.trim();
}

/** The Supabase CLI on main's exported `supabase/` folder, as the sync's ledger writer. */
function supabase(folder: string, args: readonly string[]): boolean {
  const result = spawnSync(process.execPath, ['x', 'supabase', '--workdir', folder, ...args], {
    cwd: repositoryRoot,
    env: { ...process.env, PGOPTIONS: SYNC_OPTIONS },
    stdio: 'inherit',
  });
  return result.status === 0;
}

/**
 * Runs `work` with origin/main's `supabase/` folder, exported from git into a fresh folder: the
 * stack follows main, whatever this checkout has checked out. A failed fetch keeps the last
 * fetched main, which is still main at some commit.
 */
async function withMain<T>(work: (folder: string, commit: string) => Promise<T>): Promise<T> {
  if (git(['fetch', '--quiet', 'origin', 'main']).status !== 0)
    say(`git fetch failed; using ${CHANGED_CHECK_BASE} as last fetched.`);
  const commit = git(['rev-parse', '--short=12', CHANGED_CHECK_BASE]).stdout.toString().trim();
  const archive = git(['archive', '--format=tar', CHANGED_CHECK_BASE, 'supabase']);
  if (!commit || archive.status !== 0)
    throw new Error(`git cannot read ${CHANGED_CHECK_BASE}; fetch it first.`);
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  const folder = mkdtempSync(join(homedir(), '.cache', 'werkflow-stack-'));
  try {
    const unpacked = spawnSync('tar', ['-x', '-C', folder], { input: archive.stdout });
    if (unpacked.status !== 0) throw new Error(`Unpacking ${CHANGED_CHECK_BASE}'s supabase folder failed.`);
    return await work(folder, commit);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Installs the ledger trigger unless it is in place; false when the stack refused it. */
function guard(): boolean {
  if (sql(GUARD_QUERY, '-c default_transaction_read_only=on') === 't') return true;
  if (sql(GUARD_SQL) === undefined) return false;
  say('Installed the ledger trigger: only this sync writes the migration ledger now.');
  return true;
}

function refuseAhead(drift: MigrationDrift): boolean {
  const decision = syncDecision(drift);
  if (decision.kind !== 'ahead') return false;
  for (const line of decision.lines) console.error(line);
  return true;
}

async function sync(wait: boolean): Promise<number> {
  // Before any fetch: a machine without Docker or a running stack has nothing to sync.
  if (sql('select 1', '-c default_transaction_read_only=on', true) === undefined) {
    say('The local stack is not running; nothing to sync.');
    return 0;
  }
  return withMain(async (folder, commit) => {
    const drift = readMigrationDrift(folder);
    if (!drift) {
      say('The local stack is not running or cannot be read; nothing to sync.');
      return 0;
    }
    if (refuseAhead(drift)) return 1;
    if (!guard()) return 1;
    const decision = syncDecision(drift);
    if (decision.kind === 'current') {
      say(`The shared stack is at main (${commit}).`);
      return 0;
    }
    if (decision.kind !== 'behind') return 1;
    const apply = withStackLock(
      { mode: 'exclusive', operation: 'stack sync', repositoryRoot, wait },
      async () => {
        // Another worktree's sync may have applied them while this one waited.
        const now = readMigrationDrift(folder);
        if (!now || refuseAhead(now)) return 1;
        if (now.treeOnly.length) {
          say(`Applying main's ${now.treeOnly.length} pending migrations (${commit}).`);
          if (!supabase(folder, ['migration', 'up'])) {
            console.error(
              `[stack] Applying main's migrations failed; the output is above. A ledger that holds a version main lacks needs the reset (bun run stack:reset -- ${RESET_CONFIRMATION}).`,
            );
            return 1;
          }
        }
        say(`The shared stack is at main (${commit}).`);
        return 0;
      },
    );
    return apply.catch((error: unknown) => {
      if (!(error instanceof StackHeldError)) throw error;
      say(
        `Main has ${decision.pending.length} migrations the shared stack lacks. ${error.message} The next sync applies them.`,
      );
      return 0;
    });
  });
}

async function reset(confirmed: boolean): Promise<number> {
  if (!confirmed) {
    for (const line of RESET_WARNING) console.error(line);
    return 1;
  }
  const rebuilt = withWorkspaceTestLock({ operation: 'stack reset', repositoryRoot }, () =>
    withStackLock({ mode: 'exclusive', operation: 'stack reset', repositoryRoot, wait: false }, () =>
      withMain(async (folder, commit) => {
        say(`Rebuilding the shared stack's database from main's migrations (${commit}).`);
        if (!supabase(folder, ['db', 'reset'])) return 1;
        // A reset leaves the edge runtime stopped on some machines; the test server starts it too.
        spawnSync('docker', ['start', EDGE_RUNTIME], { stdio: 'ignore' });
        const drift = readMigrationDrift(folder);
        if (!drift || syncDecision(drift).kind !== 'current' || !guard()) {
          console.error(
            '[stack] The reset ran, but the stack does not read as main; run bun run stack:sync.',
          );
          return 1;
        }
        say(`The shared stack is at main (${commit}), with the ledger trigger installed.`);
        return 0;
      }),
    ),
  );
  // A reset never queues behind a run: its world would be gone when it resumes.
  return rebuilt.catch((error: unknown) => {
    if (!(error instanceof StackHeldError)) throw error;
    for (const line of resetRefusal(error.holders)) console.error(line);
    return 1;
  });
}

process.exit(action === 'sync' ? await sync(!flags.includes('--no-wait')) : await reset(flags.length > 0));
