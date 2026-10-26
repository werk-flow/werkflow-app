import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { format } from 'prettier';

import { getSpawnFailureDetail } from '../lib/testing/runner/spawn-result';

const DEV_PROJECT_ID = 'mbkkzuqjbdvzelqvuzcn';
const REPOSITORY_ROOT = resolve(import.meta.dir, '..');
const OUTPUT_PATH = resolve(REPOSITORY_ROOT, 'lib', 'supabase', 'database.types.ts');
const CHECK_ONLY = process.argv.slice(2).includes('--check');
/**
 * From the local stack instead of DEV: a pull request's migration reaches DEV only when it
 * merges, so its types come from the stack that applied every committed migration, and CI
 * checks them there (docs/technical/environments.md, "The migration rule").
 */
const LOCAL = process.argv.slice(2).includes('--local');
const SOURCE = LOCAL ? 'local stack' : 'DEV';

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== '--check' && argument !== '--local');
if (unknownArguments.length > 0) {
  throw new Error(`Unknown argument: ${unknownArguments.join(', ')}`);
}

const generated = spawnSync(
  process.execPath,
  [
    'x',
    'supabase',
    'gen',
    'types',
    'typescript',
    ...(LOCAL ? ['--local'] : ['--project-id', DEV_PROJECT_ID]),
    '--schema',
    'graphql_public,public',
  ],
  {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);

if (generated.error || generated.status !== 0) {
  throw new Error(`Supabase type generation failed: ${getSpawnFailureDetail(generated, 'unknown error')}`);
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

const formatted = await format(withCommittedHeader(generated.stdout), {
  filepath: OUTPUT_PATH,
});

if (!CHECK_ONLY) {
  writeFileSync(OUTPUT_PATH, formatted, 'utf8');
  console.log(`[types:generate] Wrote ${SOURCE} types with Supabase 2.116.0 and Prettier 3.6.2.`);
  process.exit(0);
}

const current = readFileSync(OUTPUT_PATH, 'utf8');
if (current !== formatted) {
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 12);
  throw new Error(
    `Generated ${SOURCE} types differ from the committed file (${digest(current)} != ${digest(formatted)}). Run bun run types:generate${LOCAL ? ' -- --local' : ''} and review the schema delta.`,
  );
}

console.log(`[types:check] ${SOURCE} types match Supabase 2.116.0 and Prettier 3.6.2.`);
