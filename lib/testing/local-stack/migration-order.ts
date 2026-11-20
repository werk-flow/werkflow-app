import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrationVersionFromFileName } from './migration-history';
import { type MigrationChanges, migrationChanges, sharedChanges } from './migration-targets';

// DEV and PROD apply a merged migration with `supabase db push --include-all`, after main's
// migrations that carry a higher version; a fresh database applies them in version order. Both
// orders end in the same schema unless the two migrations change one object
// (docs/technical/environments.md, "The migration rule"). This gate refuses that case and a
// duplicate version, so a branch renames its migration only then.

const MIGRATIONS = 'supabase/migrations';

/** A migration an open pull request adds. */
export type OpenMigration = { pullRequest: number; name: string };

/** The version `supabase migration new` stamps: the UTC time as YYYYMMDDHHMMSS. */
function versionAt(time: Date): string {
  return time.toISOString().replace(/\D/g, '').slice(0, 14);
}

function timeOf(version: string): number {
  const part = (start: number, end: number): number => Number(version.slice(start, end));
  return Date.UTC(part(0, 4), part(4, 6) - 1, part(6, 8), part(8, 10), part(10, 12), part(12, 14));
}

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function migrationsAt(repositoryRoot: string, ref: string): string[] {
  return git(repositoryRoot, ['ls-tree', '--name-only', '-z', `${ref}:${MIGRATIONS}`])
    .split('\0')
    .filter((name) => migrationVersionFromFileName(name) !== null);
}

type Migration = { name: string; version: string };

const withVersion = (name: string): Migration[] => {
  const version = migrationVersionFromFileName(name);
  return version === null ? [] : [{ name, version }];
};

/**
 * One problem per migration the working tree adds since its merge base with `mainRef` that
 * shares its version with another migration on `mainRef` or in an open pull request, or changes
 * an object a migration on `mainRef` with a higher version also changes. Each names the lowest
 * free version that clears both. `openPullRequests` is null when GitHub could not be read.
 */
export function migrationOrderProblems(input: {
  repositoryRoot: string;
  mainRef: string;
  openPullRequests: readonly OpenMigration[] | null;
}): string[] {
  const root = input.repositoryRoot;
  const base = git(root, ['merge-base', 'HEAD', input.mainRef]).trim();
  const onMain = migrationsAt(root, input.mainRef).flatMap(withVersion);
  const known = new Set([...migrationsAt(root, base), ...onMain.map((migration) => migration.name)]);
  const added = readdirSync(join(root, MIGRATIONS))
    .filter((name) => !known.has(name))
    .flatMap(withVersion)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const addedNames = new Set(added.map((migration) => migration.name));
  const elsewhere = [
    ...onMain.map((other) => ({ ...other, where: `${other.name} on ${input.mainRef}` })),
    ...(input.openPullRequests ?? [])
      .filter((other) => !addedNames.has(other.name) && !known.has(other.name))
      .flatMap((other) =>
        withVersion(other.name).map((found) => ({
          ...found,
          where: `${other.name} in #${other.pullRequest}`,
        })),
      ),
  ];
  const taken = new Set(elsewhere.map((other) => other.version));
  const mainChanges = new Map<string, MigrationChanges>();
  const changesOnMain = (name: string): MigrationChanges => {
    const cached = mainChanges.get(name);
    if (cached) return cached;
    const read = migrationChanges(git(root, ['show', `${input.mainRef}:${MIGRATIONS}/${name}`]));
    mainChanges.set(name, read);
    return read;
  };
  const conflictsAt = (version: string, mine: MigrationChanges) =>
    onMain
      .filter((other) => other.version > version)
      .flatMap((other) => {
        const shared = sharedChanges(mine, changesOnMain(other.name));
        return shared.length ? [{ ...other, shared }] : [];
      });
  return added.flatMap(({ name, version }) => {
    const mine = migrationChanges(readFileSync(join(root, MIGRATIONS, name), 'utf8'));
    const twins = elsewhere.filter((other) => other.version === version).map((other) => other.where);
    const conflicts = twins.length ? [] : conflictsAt(version, mine);
    // The lowest version after the original that no other migration holds and no newer migration conflicts with.
    let free = version;
    for (;;) {
      const newer = taken.has(free) ? free : conflictsAt(free, mine).at(-1)?.version;
      if (newer === undefined) break;
      free = versionAt(new Date(timeOf(newer) + 1000));
    }
    taken.add(free);
    const rename = `Rename it to ${MIGRATIONS}/${free}${name.slice(version.length)} (docs/technical/environments.md, "The migration rule").`;
    if (twins.length)
      return [
        `${MIGRATIONS}/${name} has the version of ${twins.join(' and ')}; the ledger keeps one row per version. ${rename}`,
      ];
    if (!conflicts.length) return [];
    const named = conflicts.map((other) => `${other.name} (${other.shared.join(', ')})`).join('; ');
    return [
      `${MIGRATIONS}/${name} changes what a migration with a higher version on ${input.mainRef} also changes: ${named}. DEV and PROD applied that one first and a fresh database applies it after, so their schemas could differ. ${rename}`,
    ];
  });
}

/**
 * The migrations every open pull request adds, read with one GitHub query through `gh`, or null
 * when GitHub cannot be read or holds more than 100 open pull requests. A pull request with more
 * than 100 changed files costs one more call.
 */
export function openPullRequestMigrations(repositoryRoot: string): OpenMigration[] | null {
  const query = `query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: 100) {
        pageInfo { hasNextPage }
        nodes { number files(first: 100) { pageInfo { hasNextPage } nodes { path changeType } } }
      }
    }
  }`;
  const run = (command: string, args: string[]): string =>
    execFileSync(command, args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
  try {
    const remote = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(
      run('git', ['remote', 'get-url', 'origin']).trim(),
    );
    const owner = remote?.[1];
    const name = remote?.[2];
    if (owner === undefined || name === undefined) return null;
    const lines = run('gh', [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-F',
      `owner=${owner}`,
      '-F',
      `name=${name}`,
      '--jq',
      '.data.repository.pullRequests | if .pageInfo.hasNextPage then "more" else (.nodes[] | [.number, .files.pageInfo.hasNextPage, ([.files.nodes[] | select(.changeType != "DELETED") | .path] | join(" "))] | @tsv) end',
    ]);
    const result: OpenMigration[] = [];
    for (const line of lines.split('\n').filter(Boolean)) {
      if (line === 'more') return null;
      const [number, more, paths] = line.split('\t');
      const pullRequest = Number(number);
      const all =
        more === 'true'
          ? run('gh', [
              'api',
              '--paginate',
              `repos/${owner}/${name}/pulls/${pullRequest}/files`,
              '--jq',
              '.[] | select(.status != "removed") | .filename',
            ]).split('\n')
          : (paths ?? '').split(' ');
      for (const path of all)
        if (path.startsWith(`${MIGRATIONS}/`) && path.lastIndexOf('/') === MIGRATIONS.length)
          result.push({ pullRequest, name: path.slice(MIGRATIONS.length + 1) });
    }
    return result.filter((migration) => migrationVersionFromFileName(migration.name) !== null);
  } catch {
    return null;
  }
}
