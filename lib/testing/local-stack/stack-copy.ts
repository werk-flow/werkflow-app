import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from '../../zod';

import { type MigrationDrift, sqlShape } from './migration-drift';

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
 * A statement whose effect leaves the database it runs in, or needs what the copy lacks: roles and
 * their memberships, server settings and other databases reach the shared cluster, and pg_cron is
 * absent from the copy.
 */
const LEAVES_THE_COPY = [
  /^(?:create|alter|drop)\s+(?:role|user|group|database|tablespace)\b/i,
  /^alter\s+system\b/i,
  /^grant\s+(?:(?!\son\s).)*\sto\s/i,
  /^revoke\s+(?:(?!\son\s).)*\sfrom\s/i,
  /\b(?:cron\.|pg_cron\b)/i,
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
 * Why the copy cannot answer for this tree, or undefined when it can: the stack must hold nothing
 * the tree lacks, and no pending migration may reach past the copy. `pendingSql` holds the SQL of
 * each migration the stack lacks.
 */
export function copyRefusal(drift: MigrationDrift, pendingSql: readonly string[]): string | undefined {
  if (drift.stackOnly.length || drift.changed.length)
    return "the shared stack holds migrations this tree lacks or has with other statements (merge main, or the stack needs its reset), so a copy of it is not this tree's schema.";
  const reaching = pendingSql
    .flatMap((sql) => sqlShape(sql).split(';'))
    .find((statement) => LEAVES_THE_COPY.some((pattern) => pattern.test(statement.trim())));
  return reaching
    ? `a pending migration reaches past a private database (roles, server settings or pg_cron): ${reaching.trim().slice(0, 80)}`
    : undefined;
}

/** The SQL of this tree's migrations whose names the stack lacks. */
function pendingSql(repository: string, names: readonly string[]): string[] {
  const folder = resolve(repository, 'supabase/migrations');
  const wanted = new Set(names);
  return readdirSync(folder).flatMap((file) => {
    const name = /^\d{14}_(.+)\.sql$/.exec(file)?.[1];
    return name && wanted.has(name) ? [readFileSync(resolve(folder, file), 'utf8')] : [];
  });
}

/** One program inside the stack's database container. */
function inContainer(args: readonly string[], input?: string | Buffer) {
  return spawnSync('docker', ['exec', '-i', CONTAINER, ...args], {
    input,
    maxBuffer: 512 * 1024 * 1024,
    timeout: 300_000,
  });
}

/**
 * Runs `work` with the URL of a private database that holds the shared database's schema and this
 * tree's pending migrations, then drops it. The name is fixed per checkout, so a killed run's
 * database is dropped by the next run here and two worktrees never share one. Answers why not when
 * a limit does not hold or a step fails; `runCli` runs the Supabase CLI in the checkout.
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
  const refusal = copyRefusal(drift, pendingSql(repository, drift.treeOnly));
  if (refusal) return { unavailable: refusal };
  const { port } = configSchema.parse(
    Bun.TOML.parse(readFileSync(resolve(repository, 'supabase/config.toml'), 'utf8')),
  ).db;
  const database = `werkflow_types_${createHash('sha256').update(repository).digest('hex').slice(0, 12)}`;
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${database}`;
  const psql = (user: string, target: string, sql: string | Buffer, stop = true) =>
    inContainer(['psql', '-U', user, '-d', target, '-q', ...(stop ? ['-v', 'ON_ERROR_STOP=1'] : [])], sql);
  const drop = () => psql('postgres', 'postgres', `drop database if exists ${database} with (force);`);
  const failed = (step: string, result: { stderr: Buffer | string }) => ({
    unavailable: `${step} failed in the private database: ${result.stderr.toString().trim().split('\n')[0] ?? 'no output'}`,
  });
  try {
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
    if (loaded.status !== 0) return failed('the ledger copy', loaded);
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
    return { result: await work(url) };
  } finally {
    drop();
  }
}
