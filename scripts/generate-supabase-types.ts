import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { format } from 'prettier';

import {
  typesFromCi,
  typesHereReason,
  typesInputDigest,
  typesOnBoat,
  typesUnavailableNotice,
} from '../lib/testing/boat/types-on-boat';
import { readMigrationDrift } from '../lib/testing/local-stack/migration-drift';
import { withStackLock } from '../lib/testing/runner/stack-lock';
import { getSpawnFailureDetail } from '../lib/testing/runner/spawn-result';

const DEV_PROJECT_ID = 'mbkkzuqjbdvzelqvuzcn';
const REPOSITORY_ROOT = resolve(import.meta.dir, '..');
const OUTPUT_PATH = resolve(REPOSITORY_ROOT, 'lib', 'supabase', 'database.types.ts');
const CHECK_ONLY = process.argv.slice(2).includes('--check');
/**
 * The types of this tree's committed migrations instead of DEV's: a pull request's migration
 * reaches DEV only when it merges, and CI checks the committed types against a stack that applied
 * every committed migration (docs/technical/environments.md, "The migration rule"). CI and a Boat
 * machine read their own fresh stack. A workstation's stack is shared and holds main's migrations,
 * so a tree with its own migration takes the file from Boat, or from CI's run of the pushed commit
 * (lib/testing/boat/types-on-boat.ts).
 */
const LOCAL = process.argv.slice(2).includes('--local');

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== '--check' && argument !== '--local');
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`);
}

/**
 * A hosted project's types name its PostgREST version for supabase-js; the local stack's do not.
 * A local generation keeps the committed header, so the source of the types never changes them.
 */
const INTERNAL_HEADER =
  /\n {2}\/\/ Allows to automatically instantiate[\s\S]*?__InternalSupabase: \{[\s\S]*?\n {2}\};?\n/;
function withCommittedHeader(types: string): string {
  if (!LOCAL || INTERNAL_HEADER.test(types)) return types;
  const header = INTERNAL_HEADER.exec(readFileSync(OUTPUT_PATH, 'utf8'))?.[0];
  return header ? types.replace(/(export type Database = \{)\n/, `$1${header}`) : types;
}

/** The Supabase CLI in this checkout. */
function supabase(args: readonly string[]) {
  return spawnSync(process.execPath, ['x', 'supabase', ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The formatted types of one database: `--project-id` for DEV, `--local`, or `--db-url`. */
async function generatedFrom(database: readonly string[]): Promise<string> {
  const generated = supabase([
    'gen',
    'types',
    'typescript',
    ...database,
    '--schema',
    'graphql_public,public',
  ]);
  if (generated.error || generated.status !== 0) {
    throw new Error(`Supabase type generation failed: ${getSpawnFailureDetail(generated, 'unknown error')}`);
  }
  return format(withCommittedHeader(generated.stdout), { filepath: OUTPUT_PATH });
}

/**
 * The types from the stack on this machine, where it has the tree's schema. A workstation reads
 * them under a shared hold of the stack, so the sync cannot move it between the ledger read and the
 * generation; a writer outside the lock is caught by a second read of the ledger.
 *
 * A private database inside the shared stack's Postgres was tried and dropped: a tree's pending SQL
 * runs there in the same cluster, and three review rounds each found a statement a guard admitted
 * that created a cluster-wide role (werk-flow/werkflow-app#362). Nothing short of a separate server
 * proves that SQL stays in one database.
 */
async function typesHere(): Promise<{ formatted: string; source: string } | { unavailable: string }> {
  // '' on CI and on a Boat machine, whose stack is the run's own, at the tree's migrations.
  if (typesHereReason(process.env, () => undefined) === '')
    return { formatted: await generatedFrom(['--local']), source: 'local stack' };
  return withStackLock(
    { mode: 'shared', operation: 'types from the shared stack', repositoryRoot: REPOSITORY_ROOT },
    async () => {
      const drift = readMigrationDrift(REPOSITORY_ROOT);
      if (!drift) return { unavailable: 'the shared stack is not running or cannot be read.' };
      const here = typesHereReason(process.env, () => drift);
      if (!here) return { unavailable: "the shared stack does not hold exactly this tree's migrations." };
      console.info(`[types] Reading the local stack: ${here}`);
      const formatted = await generatedFrom(['--local']);
      return JSON.stringify(readMigrationDrift(REPOSITORY_ROOT)) === JSON.stringify(drift)
        ? { formatted, source: 'local stack' }
        : { unavailable: 'the shared stack changed while its types were read.' };
    },
  );
}

/** The formatted types and the stack they come from. */
async function types(): Promise<{ formatted: string; source: string }> {
  if (!LOCAL) return { formatted: await generatedFrom(['--project-id', DEV_PROJECT_ID]), source: 'DEV' };
  const here = await typesHere();
  if ('formatted' in here) return here;
  console.info(`[types] Not from the shared stack: ${here.unavailable}`);
  console.info('[types] Boat generates the types on a fresh stack.');
  const boat = await typesOnBoat(REPOSITORY_ROOT);
  if ('types' in boat) return { formatted: boat.types, source: 'Boat stack' };
  if ('failed' in boat) {
    console.error('[types] The generation failed on the Boat machine; its output is above.');
    process.exit(boat.failed);
  }
  const ci = typesFromCi(REPOSITORY_ROOT);
  if ('types' in ci) {
    console.info(
      `[types] Boat is unavailable: ${boat.unavailable} CI's SQL job generated the types for HEAD.`,
    );
    return { formatted: ci.types, source: 'CI stack' };
  }
  for (const line of typesUnavailableNotice(boat.unavailable, ci.unavailable)) console.error(line);
  process.exit(1);
}

const { formatted, source: SOURCE } = await types();

if (!CHECK_ONLY) {
  writeFileSync(OUTPUT_PATH, formatted, 'utf8');
  console.log(`[types:generate] Wrote ${SOURCE} types with Supabase 2.116.0 and Prettier 3.6.2.`);
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, 'utf8');
if (current !== formatted) {
  // CI keeps the file it generated: a workstation without Boat takes its types from there.
  const artifact = process.env.WERKFLOW_TYPES_ARTIFACT;
  if (artifact) {
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, formatted, 'utf8');
    writeFileSync(
      resolve(dirname(artifact), 'inputs.sha256'),
      `${typesInputDigest(REPOSITORY_ROOT)}\n`,
      'utf8',
    );
  }
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12);
  throw new Error(
    `Generated ${SOURCE} types differ from the committed file (${digest(current)} != ${digest(formatted)}). Run bun run types:generate${LOCAL ? ' -- --local' : ''} and review the schema delta.`,
  );
}

console.log(`[types:check] ${SOURCE} types match Supabase 2.116.0 and Prettier 3.6.2.`);
