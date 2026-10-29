import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrationVersionFromFileName } from './migration-history';

// `supabase db push` on DEV refuses a migration whose version sorts at or
// before one it already applied, so a branch whose migration was written
// before main's newest fails only after the merge (docs/technical/environments.md,
// "The migration rule"). This gate fails the branch first.

const MIGRATIONS = 'supabase/migrations';

/** The version `supabase migration new` stamps: the UTC time as YYYYMMDDHHMMSS. */
function versionAt(time: Date): string {
  return time.toISOString().replace(/\D/g, '').slice(0, 14);
}

function timeOf(version: string): number {
  const part = (start: number, end: number): number => Number(version.slice(start, end));
  return Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(8, 10), part(10, 12), part(12, 14));
}

function migrationsAt(repositoryRoot: string, ref: string): string[] {
  return execFileSync('git', ['ls-tree', '--name-only', '-z', `${ref}:${MIGRATIONS}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter((name) => migrationVersionFromFileName(name) !== null);
}

/**
 * One problem per migration the working tree adds since its merge base with
 * `mainRef` whose version is at or before the newest migration on `mainRef`,
 * each with a free version to rename it to.
 */
export function migrationOrderProblems(input: {
  repositoryRoot: string;
  mainRef: string;
  now: Date;
}): string[] {
  const base = execFileSync('git', ['merge-base', 'HEAD', input.mainRef], {
    cwd: input.repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const onMain = migrationsAt(input.repositoryRoot, input.mainRef);
  const known = new Set([...migrationsAt(input.repositoryRoot, base), ...onMain]);
  const newest = onMain.sort().at(-1);
  const newestVersion = newest === undefined ? null : migrationVersionFromFileName(newest);
  if (newest === undefined || newestVersion === null) return [];
  const stale = readdirSync(join(input.repositoryRoot, MIGRATIONS))
    .filter((name) => !known.has(name))
    .flatMap((name) => {
      const version = migrationVersionFromFileName(name);
      return version !== null && version <= newestVersion ? [{ name, version }] : [];
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const first = Math.max(input.now.getTime(), timeOf(newestVersion) + 1000);
  return stale.map(({ name, version }, index) => {
    const rename = `${versionAt(new Date(first + index * 1000))}${name.slice(version.length)}`;
    return `${MIGRATIONS}/${name} sorts at or before ${newest}, the newest migration on ${input.mainRef}, so supabase db push would refuse it after the merge. Rename it to ${MIGRATIONS}/${rename} (docs/technical/environments.md, "The migration rule").`;
  });
}
