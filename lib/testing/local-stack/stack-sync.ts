import { type MigrationDrift } from './migration-drift';

// The local stack every worktree of a workstation shares is main at some commit: it holds main's
// merged migrations and nothing else (docs/technical/environments.md, "The migration rule").
// `bun run stack:sync` (scripts/local-stack.ts) is the one writer of its migration ledger: it
// applies origin/main's pending migrations under the exclusive stack lock and refuses a stack that
// holds anything main lacks. A trigger on the ledger keeps every other writer out, whatever shell,
// tool or branch it comes from; this module holds that trigger and the sync's decisions.

/**
 * The session setting only the sync opens its connection with. The Supabase CLI builds its
 * connection through pgx, which reads PGOPTIONS, so the sync passes it in the environment.
 */
export const SYNC_OPTIONS = '-c werkflow.stack_sync=main';

const REFUSAL =
  "Refused: this local stack is shared by every worktree and takes only main's migrations, through bun run stack:sync. " +
  'A branch migration never runs here: bun run types:generate -- --local writes its types and bun run test:verify tests it, ' +
  'and neither changes this database (docs/technical/environments.md, The migration rule).';

const GUARD_TRIGGERS = ['werkflow_main_only', 'werkflow_main_only_truncate'] as const;

/**
 * Installs the ledger trigger, again and again without harm. The Supabase CLI records a migration
 * in the same implicit transaction that ran its statements, so a refused ledger row rolls the
 * migration back: `supabase migration up`, `db push --local` and `migration repair --local` all
 * fail before they change the stack. The CLI prints the message and drops the hint, so the
 * message carries the sanctioned commands.
 */
export const GUARD_SQL = `
begin;
create or replace function supabase_migrations.werkflow_main_only() returns trigger
language plpgsql as $guard$
begin
  if current_setting('werkflow.stack_sync', true) = 'main' then
    return coalesce(new, old);
  end if;
  raise exception '${REFUSAL.replaceAll("'", "''")}';
end
$guard$;
drop trigger if exists ${GUARD_TRIGGERS[0]} on supabase_migrations.schema_migrations;
create trigger ${GUARD_TRIGGERS[0]} before insert or update or delete on supabase_migrations.schema_migrations
  for each row execute function supabase_migrations.werkflow_main_only();
drop trigger if exists ${GUARD_TRIGGERS[1]} on supabase_migrations.schema_migrations;
create trigger ${GUARD_TRIGGERS[1]} before truncate on supabase_migrations.schema_migrations
  for each statement execute function supabase_migrations.werkflow_main_only();
commit;
`;

/** Answers `t` when both ledger triggers exist and fire, in a read-only session. */
export const GUARD_QUERY = `select count(*) = ${GUARD_TRIGGERS.length} from pg_trigger where tgrelid = 'supabase_migrations.schema_migrations'::regclass and tgname in (${GUARD_TRIGGERS.map((name) => `'${name}'`).join(', ')}) and tgenabled = 'O'`;

/** Where the reset's steps live. */
const RESET_DOC = 'the supabase-live-workflow skill, "Reset the shared stack"';

export type SyncDecision =
  /** The stack holds a migration main lacks, one whose statements differ or one it cannot prove: only a reset repairs it. */
  | { kind: 'ahead'; lines: string[] }
  /** The stack answered, but its ledger could not be read: nothing proves it is main. */
  | { kind: 'unreadable'; lines: string[] }
  /** Main has merged migrations the stack lacks, by name. */
  | { kind: 'behind'; pending: readonly string[] }
  | { kind: 'current' };

const named = (names: readonly string[]) =>
  `${names.slice(0, 5).join(', ')}${names.length > 5 ? `, and ${names.length - 5} more` : ''}`;

/**
 * What the sync does about the drift between the stack's ledger and main's migrations; `undefined`
 * is a ledger read that failed on a stack that answered (a timeout, no ledger table, rows of an
 * unknown shape), which never passes as main.
 */
export function syncDecision(drift: MigrationDrift | undefined): SyncDecision {
  if (!drift)
    return {
      kind: 'unreadable',
      lines: [
        "The shared local stack answers, but its migration ledger could not be read, so nothing proves it is main's.",
        `Check that supabase_migrations.schema_migrations exists and answers; a stack without its ledger needs the reset (${RESET_DOC}).`,
      ],
    };
  const { stackOnly, changed, treeOnly, unverified } = drift;
  if (stackOnly.length || changed.length || unverified.length)
    return {
      kind: 'ahead',
      lines: [
        'The shared local stack holds migrations main lacks, so it is no longer main at some commit:',
        ...(stackOnly.length ? [`  ${stackOnly.length} not on main: ${named(stackOnly)}`] : []),
        ...(changed.length
          ? [`  ${changed.length} applied with other statements than main's: ${named(changed)}`]
          : []),
        ...(unverified.length
          ? [`  ${unverified.length} recorded without their statements, so unproven: ${named(unverified)}`]
          : []),
        'Every SQL and browser plan on this machine drifts until the stack is reset to main. Tell your lead:',
        `the reset is announced first and runs when no worktree holds the stack (${RESET_DOC}).`,
      ],
    };
  return treeOnly.length ? { kind: 'behind', pending: treeOnly } : { kind: 'current' };
}

/** The lines a refused reset prints: who holds the stack, and that a reset reaches each of them. */
export function resetRefusal(
  holders: readonly { operation: string; workspace: string; mode: string; startedAt: string }[],
): string[] {
  return [
    `Refused: ${holders.length} runs hold the shared local stack, and a reset deletes the test world each of them uses:`,
    ...holders.map(
      (holder) =>
        `  "${holder.operation}" (${holder.mode}, ${holder.workspace}, started ${holder.startedAt})`,
    ),
    'Run the reset when they have ended.',
  ];
}

/** What the confirmation flag stands for, printed when it is missing. */
export const RESET_CONFIRMATION = '--destroy-test-data';
export const RESET_WARNING = [
  `Refused: a reset needs ${RESET_CONFIRMATION}, because it deletes what every worktree on this machine keeps in the stack:`,
  "  each worktree's retained test worlds and the lab world, every storage object, auth user and captured mail.",
  `Announce it first and run it when no worktree holds the stack (${RESET_DOC}):`,
  `  bun run stack:reset -- ${RESET_CONFIRMATION}`,
];
