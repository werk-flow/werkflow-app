import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from '../../zod';

// Every worktree tests against one shared local stack, which may hold migrations this tree lacks
// (another branch applied its own) or lack this tree's. A plan that reads that stack would then test
// a schema this tree does not define (docs/technical/testing.md#recurring-traps).

/** Groups whose tests read the shared local stack: SQL assertions and local browser worlds. */
const SHARED_STACK_GROUP = /^(?:sql|golden|audit):/;
/** How many names each part of the drift line shows. */
const NAMED = 3;
/** The stack's migration ledger, read in a read-only transaction. */
const LEDGER_QUERY =
  "select coalesce(json_agg(json_build_object('version', version, 'name', name, 'statements', statements)), '[]') from supabase_migrations.schema_migrations";
const ledgerSchema = z.array(
  z.object({
    version: z.string(),
    name: z.string().nullable(),
    statements: z.array(z.string()).nullable(),
  }),
);

type LedgerRow = z.infer<typeof ledgerSchema>[number];
type TreeMigration = { readonly name: string; readonly sql: string };

export type MigrationDrift = {
  /** Names the stack applied that no tree migration has. */
  readonly stackOnly: readonly string[];
  /** Names of tree migrations the stack never applied. */
  readonly treeOnly: readonly string[];
  /** Names on both sides whose SQL differs. */
  readonly changed: readonly string[];
  /**
   * Names matched by name alone, because the ledger row records no statements: no drift for a
   * plan, but no proof that the stack ran the tree's SQL.
   */
  readonly unverified: readonly string[];
};

/** Whether a plan that runs these groups reads the shared local stack. */
export function readsSharedStack(groupIds: readonly string[]): boolean {
  return groupIds.some((id) => SHARED_STACK_GROUP.test(id));
}

const IDENTIFIER = /[A-Za-z0-9_]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const PLAIN = /[^\s;'"$/-]+/y;
/** What may part two quoted segments that Postgres reads as one string: whitespace with a newline. */
const CONTINUATION = /^(?:[ \t\f\n]|--[^\n]*)*$/;

/** The end of the quoted literal or identifier that opens at `start`. */
function quoteEnd(text: string, start: number, quote: string, escapes: boolean): number {
  let at = start + 1;
  while (at < text.length) {
    const char = text[at];
    if (escapes && char === '\\') at += 2;
    else if (char === quote && text[at + 1] === quote) at += 2;
    else if (char === quote) return at + 1;
    else at++;
  }
  return text.length;
}

/** The end of the block comment that opens at `start`; Postgres nests them. */
function blockCommentEnd(text: string, start: number): number {
  let depth = 0;
  let at = start;
  while (at < text.length) {
    if (text.startsWith('/*', at)) {
      depth++;
      at += 2;
    } else if (text.startsWith('*/', at)) {
      at += 2;
      if (--depth === 0) return at;
    } else at++;
  }
  return text.length;
}

/**
 * Whether the single-quoted segment that opens at `at` reads backslash escapes: an E'…' literal,
 * or a segment that continues one across a newline, which keeps its escape mode.
 */
function readsEscapes(
  text: string,
  at: number,
  last: { end: number; escapes: boolean } | undefined,
): boolean {
  if (/[eE]/.test(text[at - 1] ?? '') && !IDENTIFIER.test(text[at - 2] ?? '')) return true;
  if (!last) return false;
  const between = text.slice(last.end, at);
  return last.escapes && between.includes('\n') && CONTINUATION.test(between);
}

/**
 * The SQL as Postgres tokenizes it: comments dropped, every run of whitespace outside a literal
 * turned into one space and every run holding a statement semicolon into one `;`, with none at
 * either end, and every quoted literal, quoted identifier and dollar-quoted body kept byte for
 * byte. Line endings count as `\n`.
 *
 * The Supabase CLI records a migration as the statements it cut at each top-level semicolon, each
 * trimmed of surrounding whitespace, so those statements joined by newline and semicolon have the
 * shape of the file it applied. Two texts of one shape run the same statements; a file whose
 * comments or layout changed after it was applied is no drift.
 */
export function sqlShape(sql: string): string {
  const text = sql.replace(/\r\n/g, '\n');
  const pieces: string[] = [];
  let gap: '' | ' ' | ';' = '';
  let last: { end: number; escapes: boolean } | undefined;
  let at = 0;
  const emit = (end: number) => {
    if (gap && pieces.length) pieces.push(gap);
    gap = '';
    pieces.push(text.slice(at, end));
    at = end;
  };
  while (at < text.length) {
    const char = text[at] ?? '';
    if (char === ';' || /\s/.test(char)) {
      if (char === ';') gap = ';';
      else if (!gap) gap = ' ';
      at++;
    } else if (text.startsWith('--', at) || text.startsWith('/*', at)) {
      const end = char === '-' ? text.indexOf('\n', at) : blockCommentEnd(text, at);
      at = end < 0 ? text.length : end;
      gap = gap || ' ';
    } else if (char === "'") {
      const escapes = readsEscapes(text, at, last);
      emit(quoteEnd(text, at, "'", escapes));
      last = { end: at, escapes };
    } else if (char === '"') {
      emit(quoteEnd(text, at, '"', false));
    } else {
      DOLLAR_TAG.lastIndex = at;
      const free = !IDENTIFIER.test(text[at - 1] ?? '');
      const tag = char === '$' && free ? DOLLAR_TAG.exec(text)?.[0] : undefined;
      if (tag) {
        const close = text.indexOf(tag, at + tag.length);
        emit(close < 0 ? text.length : close + tag.length);
      } else {
        PLAIN.lastIndex = at;
        emit(PLAIN.exec(text) ? PLAIN.lastIndex : at + 1);
      }
    }
  }
  return pieces.join('');
}

/** Groups values under their key, in order. */
function byName<T>(items: readonly T[], name: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(name(item), [...(groups.get(name(item)) ?? []), item]);
  return groups;
}

/**
 * How the stack's ledger differs from the tree's migrations, by name and statements, never by
 * version: a migration renamed to a later version before merge, with the same statements, is no
 * drift. A ledger row without statements (written by `supabase migration repair`) matches by name.
 */
export function migrationDrift(tree: readonly TreeMigration[], ledger: readonly LedgerRow[]): MigrationDrift {
  const files = byName(tree, (migration) => migration.name);
  const rows = byName(ledger, (row) => row.name ?? row.version);
  const stackOnly: string[] = [];
  const treeOnly: string[] = [];
  const changed: string[] = [];
  const unverified: string[] = [];
  for (const name of [...new Set([...rows.keys(), ...files.keys()])].sort()) {
    const shapes = (files.get(name) ?? []).map((migration) => sqlShape(migration.sql));
    // Rows with statements claim their file first; a row without them takes any file left.
    const applied = (rows.get(name) ?? []).toSorted(
      (a, b) => Number(!a.statements?.length) - Number(!b.statements?.length),
    );
    if (!shapes.length) stackOnly.push(...applied.map(() => name));
    else if (!applied.length) treeOnly.push(...shapes.map(() => name));
    else {
      const open = [...shapes];
      const unmatched = applied.filter(({ statements }) => {
        const index = statements?.length ? open.indexOf(sqlShape(statements.join('\n;\n'))) : open.length - 1;
        if (index >= 0) open.splice(index, 1);
        if (index >= 0 && !statements?.length) unverified.push(name);
        return index < 0;
      });
      if (unmatched.length || open.length) changed.push(name);
    }
  }
  return { stackOnly, treeOnly, changed, unverified };
}

/** One line naming the drift, or undefined when there is none or it could not be read. */
export function driftLine(drift: MigrationDrift | undefined): string | undefined {
  if (!drift) return undefined;
  const { stackOnly, treeOnly, changed } = drift;
  if (!stackOnly.length && !treeOnly.length && !changed.length) return undefined;
  const named = (names: readonly string[]) =>
    names.length ? ` (${names.slice(0, NAMED).join(', ')}${names.length > NAMED ? ', …' : ''})` : '';
  const parts = [
    `${stackOnly.length} migrations only on the shared stack${named(stackOnly)}`,
    `${treeOnly.length} only in this tree${named(treeOnly)}`,
    ...(changed.length ? [`${changed.length} with other statements${named(changed)}`] : []),
  ];
  return `The shared stack's migrations drift from this tree's: ${parts.join(', ')}.`;
}

/** This tree's migrations, by name: the file name without its version and extension. */
function treeMigrations(repository: string): TreeMigration[] {
  const folder = resolve(repository, 'supabase/migrations');
  return readdirSync(folder).flatMap((file) => {
    const name = /^\d{14}_(.+)\.sql$/.exec(file)?.[1];
    return name ? [{ name, sql: readFileSync(resolve(folder, file), 'utf8') }] : [];
  });
}

/**
 * The drift between the shared stack and this tree's migrations, read without any write; undefined
 * when the tree has no migrations folder or the stack cannot be read, so the run goes on as before.
 */
export function readMigrationDrift(repository: string): MigrationDrift | undefined {
  try {
    const tree = treeMigrations(repository);
    const raw = execFileSync(
      'docker',
      [
        'exec',
        '-e',
        'PGOPTIONS=-c default_transaction_read_only=on',
        'supabase_db_werkflow-app',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-tA',
        '-c',
        LEDGER_QUERY,
      ],
      {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return migrationDrift(tree, ledgerSchema.parse(JSON.parse(raw)));
  } catch {
    return undefined;
  }
}

/**
 * The line a local run that reads the shared stack prints before it starts, or undefined: no group
 * reads the stack, the stack matches, or the run is CI or the Boat machine, whose stack is fresh.
 */
export function localDriftNotice(
  repository: string,
  groupIds: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (env.CI === 'true' || env.WERKFLOW_BOAT_MACHINE === '1' || !readsSharedStack(groupIds)) return undefined;
  const drift = driftLine(readMigrationDrift(repository));
  return drift
    ? `${drift} A failure on an object this tree does not define is environment (docs/technical/testing.md#recurring-traps).`
    : undefined;
}
