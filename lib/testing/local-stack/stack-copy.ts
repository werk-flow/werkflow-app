import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from '../../zod';

import { type MigrationDrift, readMigrationDrift, sqlShape, sqlStatements } from './migration-drift';

// The types of a tree whose own migration the shared local stack lacks, without a second stack and
// without touching the shared database: a private database in the same Postgres server takes a
// schema-only copy of the shared one, then the tree's pending migrations
// (scripts/generate-supabase-types.ts). The shared database is only read, by pg_dump.
//
// Measured on a fresh stack (werk-flow/werkflow-planning#294): the copy takes about 6 s, and
// `supabase gen types --db-url` on it prints the same bytes as `--local` on the shared database.
// Postgres cannot copy the shared database as a template while its services are connected, so the
// copy is a dump and restore, and pg_cron exists only in the database the server names, so the copy
// has no `cron` schema. The copy therefore answers only when every limit below holds; otherwise
// the caller takes the types from Boat.

const CONTAINER = 'supabase_db_werkflow-app';
const configSchema = z.object({ db: z.object({ port: z.number() }) });
/** The restore errors a copy always has: pg_cron and its schema live only in the shared database. */
const EXPECTED_RESTORE_ERROR =
  /schema "cron" does not exist|extension "pg_cron" does not exist|can only create extension in database/;
/**
 * The statement forms a pending migration may use in the copy: one database's schema objects,
 * their comments and privileges, and transaction and session settings. None runs code when it
 * executes, except a function an index, a default or a check calls, and those come from this tree
 * (CHANGES_THE_CLUSTER holds for every one of its migrations). Everything else goes to Boat: `do`,
 * `select` and `call` run code, DML fires triggers, `create extension` runs its scripts, `copy`
 * reaches files.
 */
const DATABASE_LOCAL = [
  /^create (?:or replace )?(?:table|(?:unique )?index|function|procedure|(?:constraint )?trigger|type|policy|sequence|(?:materialized )?view|schema|domain)\b/,
  /^alter (?:table|index|function|procedure|type|policy|sequence|(?:materialized )?view|publication|schema|domain|trigger)\b/,
  /^drop (?:table|index|function|procedure|trigger|type|policy|sequence|(?:materialized )?view|domain)\b/,
  /^comment on (?!role\b|database\b|tablespace\b)/,
  /^(?:grant|revoke) .* on (?!database\b|tablespace\b|foreign\b)/,
  /^alter default privileges\b/,
  /^(?:begin|commit|set|reset)\b/,
];
/**
 * Text that changes the cluster beyond one database, wherever it stands, function bodies included:
 * roles and their memberships, databases, tablespaces and server settings.
 */
const CHANGES_THE_CLUSTER = [
  /\b(?:create|alter|drop)\s+(?:role|user|group|database|tablespace)\b/i,
  /\balter\s+system\b/i,
  /\bon\s+(?:database|tablespace)\b/i,
  /\b(?:grant|revoke)(?:\s+(?!on\b|to\b|from\b)[\w",.]+)+\s+(?:to|from)\s/i,
];
/**
 * Text in a pending migration the copy cannot run: dynamic SQL, whose statement no guard reads,
 * pg_cron, which the copy lacks, and calls that reach other databases, sessions or files.
 */
const OUTSIDE_THE_COPY = [
  /\bexecute\b(?!\s+(?:function|procedure|on)\b)/i,
  /\b(?:cron\.|pg_cron\b)/i,
  /\bdblink|_fdw\b|\b(?:security\s+label|lo_import|lo_export|pg_terminate_backend|pg_cancel_backend|pg_reload_conf)\b/i,
];

/** A migration ledger has no user trigger in the copy: only the tree's own migrations are written there. */
const DROP_LEDGER_TRIGGERS = `
do $$ declare found record; begin
  for found in select tgname from pg_trigger
    where tgrelid = 'supabase_migrations.schema_migrations'::regclass and not tgisinternal loop
    execute format('drop trigger %I on supabase_migrations.schema_migrations', found.tgname);
  end loop;
end $$;
`;

/**
 * Why the copy cannot answer for this tree, or undefined when it can: the stack holds nothing the
 * tree lacks and can prove it, every pending statement is DATABASE_LOCAL and none reaches outside
 * the copy, and no migration of the tree changes the cluster. `pendingSql` holds the SQL of each
 * migration the stack lacks, `treeSql` that of every migration of the tree.
 */
export function copyRefusal(
  drift: MigrationDrift,
  pendingSql: readonly string[],
  treeSql: readonly string[],
): string | undefined {
  if (drift.unverified.length)
    return `the shared stack's ledger records ${drift.unverified.length} migrations without their statements (${drift.unverified.slice(0, 3).join(', ')}), so nothing proves it ran this tree's SQL.`;
  if (drift.stackOnly.length || drift.changed.length)
    return "the shared stack holds migrations this tree lacks or has with other statements (merge main, or the stack needs its reset), so a copy of it is not this tree's schema.";
  const shown = (text: string) => text.slice(0, 80);
  const statement = pendingSql
    .flatMap((sql) => sqlStatements(sql))
    .find((text) => !DATABASE_LOCAL.some((form) => form.test(text.toLowerCase())));
  if (statement !== undefined)
    return `a pending statement runs code or reaches past a private database: ${shown(statement)}`;
  const outside = pendingSql
    .map((sql) => sqlShape(sql))
    .flatMap((text) =>
      [...OUTSIDE_THE_COPY, ...CHANGES_THE_CLUSTER].flatMap((rule) => rule.exec(text)?.[0] ?? []),
    );
  if (outside[0]) return `a pending migration reaches past a private database: ${shown(outside[0])}`;
  const cluster = treeSql
    .map((sql) => sqlShape(sql))
    .flatMap((text) => CHANGES_THE_CLUSTER.flatMap((rule) => rule.exec(text)?.[0] ?? []));
  return cluster[0]
    ? `a migration of this tree changes the cluster (${shown(cluster[0])}), so a function the pending DDL calls might too.`
    : undefined;
}

/** The SQL of this tree's migrations, those named in `names` or, without it, every one. */
function migrationSql(repository: string, names?: readonly string[]): string[] {
  const folder = resolve(repository, 'supabase/migrations');
  const wanted = names && new Set(names);
  return readdirSync(folder).flatMap((file) => {
    const name = /^\d{14}_(.+)\.sql$/.exec(file)?.[1];
    return name && (!wanted || wanted.has(name)) ? [readFileSync(resolve(folder, file), 'utf8')] : [];
  });
}

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((name, index) => name === [...b].sort()[index]);

/** One program inside the stack's database container. */
function inContainer(args: readonly string[], input?: string | Buffer) {
  return spawnSync('docker', ['exec', '-i', CONTAINER, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
}

/** psql in the stack's database container, as `user` on the database `target`. */
function psql(user: string, target: string, sql: string | Buffer, stop = true) {
  return inContainer(
    ['psql', '-U', user, '-d', target, '-q', ...(stop ? ['-v', 'ON_ERROR_STOP=1'] : [])],
    sql,
  );
}

/** A step that failed in the private database, with the first line of its error. */
function failed(step: string, result: { stderr: Buffer | string }): { unavailable: string } {
  return {
    unavailable: `${step} failed in the private database: ${result.stderr.toString().trim().split('\n')[0] ?? 'no output'}`,
  };
}

/**
 * Creates the private database afresh and fills it with the shared database's schema and ledger.
 * Answers why not when a step fails or the restore is not faithful.
 */
function fillCopy(database: string): { unavailable: string } | undefined {
  const created = psql(
    'postgres',
    'postgres',
    `drop database if exists ${database} with (force);\ncreate database ${database};`,
  );
  if (created.status !== 0) return failed('creating it', created);
  const schema = inContainer(['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only']);
  if (schema.status !== 0) return failed('the schema dump', schema);
  // As the stack's superuser, so ownership, default privileges and platform schemas restore.
  const restored = psql('supabase_admin', database, schema.stdout, false);
  const unexpected = restored.stderr
    .toString()
    .split('\n')
    .find((line) => line.includes('ERROR:') && !EXPECTED_RESTORE_ERROR.test(line));
  if (restored.status !== 0 || unexpected)
    return { unavailable: `the schema copy is not faithful: ${unexpected ?? 'psql failed'}` };
  const ledger = inContainer([
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--data-only',
    '--table',
    'supabase_migrations.schema_migrations',
  ]);
  if (ledger.status !== 0) return failed('the ledger dump', ledger);
  const loaded = psql('supabase_admin', database, `${DROP_LEDGER_TRIGGERS}\n${ledger.stdout.toString()}`);
  return loaded.status === 0 ? undefined : failed('the ledger copy', loaded);
}

/**
 * Runs `work` with the URL of a private database that holds the shared database's schema and this
 * tree's pending migrations, then drops it. The name is fixed per checkout, so a killed run's
 * database is dropped by the next run here and two worktrees never share one. Answers why not when
 * a limit does not hold or a step fails; `runCli` runs the Supabase CLI in the checkout. The caller
 * holds the shared stack, so the sync cannot move it between the two dumps; the copy's own ledger
 * is checked against the stack's before and after the pending migrations all the same.
 */
export async function withStackCopy<T>(
  input: {
    repository: string;
    drift: MigrationDrift;
    runCli: (args: readonly string[]) => { status: number | null; stderr: string };
  },
  work: (databaseUrl: string) => Promise<T>,
): Promise<{ result: T } | { unavailable: string }> {
  const { repository, drift, runCli } = input;
  const refusal = copyRefusal(drift, migrationSql(repository, drift.treeOnly), migrationSql(repository));
  if (refusal) return { unavailable: refusal };
  const { port } = configSchema.parse(
    Bun.TOML.parse(readFileSync(resolve(repository, 'supabase/config.toml'), 'utf8')),
  ).db;
  const database = `werkflow_types_${createHash('sha256').update(repository).digest('hex').slice(0, 12)}`;
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`;
  const drop = () => psql('postgres', 'postgres', `drop database if exists ${database} with (force);`);
  const attempt = async (): Promise<{ result: T } | { unavailable: string }> => {
    const filled = fillCopy(database);
    if (filled) return filled;
    // Both dumps must show one moment: the copy lacks exactly the tree's pending migrations.
    const copied = readMigrationDrift(repository, database);
    if (!copied || !sameNames(copied.treeOnly, drift.treeOnly) || driftsBeyondPending(copied))
      return { unavailable: "the copy's ledger is not the shared stack's at one moment." };
    const applied = runCli(['migration', 'up', '--db-url', url]);
    if (applied.status !== 0)
      return {
        unavailable: `the tree's pending migrations did not apply to the private database: ${
          applied.stderr
            .trim()
            .split('\n')
            .find((line) => line.startsWith('ERROR')) ?? 'see the CLI output'
        }`,
      };
    const after = readMigrationDrift(repository, database);
    if (!after || after.treeOnly.length || driftsBeyondPending(after))
      return { unavailable: "the copy does not hold exactly this tree's migrations after they applied." };
    return { result: await work(url) };
  };
  let outcome: { result: T } | { unavailable: string };
  try {
    outcome = await attempt();
  } finally {
    const dropped = drop();
    if (dropped.status !== 0)
      outcome = {
        unavailable: `the private database ${database} could not be dropped (${dropped.stderr.toString().trim().split('\n')[0] ?? 'no output'}); drop it with docker exec ${CONTAINER} psql -U postgres -c 'drop database ${database} with (force)'.`,
      };
  }
  return outcome;
}

/** Whether a ledger holds anything the tree lacks, has otherwise, or cannot prove. */
function driftsBeyondPending(drift: MigrationDrift): boolean {
  return drift.stackOnly.length > 0 || drift.changed.length > 0 || drift.unverified.length > 0;
}
