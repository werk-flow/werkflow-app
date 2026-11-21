import ts from 'typescript';
import { z } from 'zod';

/**
 * What a change of `package.json` or `bun.lock` runs (owner decision D3,
 * werk-flow/werkflow-planning#503), strongest first:
 * - `every-group`: a runtime or Playwright dependency, a package the build or the local stack loads,
 *   or anything the classifier cannot place.
 * - `tooling`: a development tool; the plan runs the affected groups, the runner pilots and one
 *   group of every shard kind, and main's next full run starts at once.
 * - `lint-type`: only lint and type packages; Lint and the static gates run.
 */
type DependencyEffect = 'every-group' | 'tooling' | 'lint-type';
export type DependencyChange = { effect: DependencyEffect; reason: string };

const STRENGTH: Readonly<Record<DependencyEffect, number>> = { 'every-group': 2, tooling: 1, 'lint-type': 0 };

/** The stronger of the changes; the first of two equal ones. */
const strongest = (changes: readonly DependencyChange[]): DependencyChange | undefined =>
  changes.reduce<DependencyChange | undefined>(
    (best, change) => (!best || STRENGTH[change.effect] > STRENGTH[best.effect] ? change : best),
    undefined,
  );

/**
 * Development packages only Lint, the static gates and unit tests load. dependency-change.test.ts
 * fails when other code imports one, so a package stays here only while that holds.
 */
export const LINT_AND_TYPE_PACKAGES =
  /^(@types\/.+|eslint|eslint-config-.+|eslint-plugin-.+|@eslint\/.+|@eslint-community\/.+|knip|typescript7)$/;
/**
 * Development packages the browser groups, the build or the local stack load. A package counts by
 * each of its names: the one it is installed as, an `npm:` alias's target, and the lock's resolved name.
 */
const RUNTIME_DEVELOPMENT_PACKAGES =
  /^(@playwright\/.+|playwright(-.+)?|@axe-core\/playwright|tailwindcss|@tailwindcss\/.+|supabase)$/;
const RUNTIME_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
const SECTIONS = [...RUNTIME_SECTIONS, 'devDependencies'] as const;

const dependencyMap = z.record(z.string(), z.string()).optional();
const manifestSchema = z.object({
  dependencies: dependencyMap,
  optionalDependencies: dependencyMap,
  peerDependencies: dependencyMap,
  devDependencies: dependencyMap,
});
type Manifest = z.infer<typeof manifestSchema>;

/** What a move of the root package `name` runs, read from both versions of its manifest. */
function rootEffect(name: string, manifests: readonly Manifest[]): DependencyChange {
  if (
    manifests.some((manifest) =>
      RUNTIME_SECTIONS.some((section) => Object.hasOwn(manifest[section] ?? {}, name)),
    )
  )
    return { effect: 'every-group', reason: `runtime dependency ${name}` };
  const aliases = manifests.flatMap((manifest) =>
    SECTIONS.flatMap((section) => /^npm:(@?[^@]+)@/.exec(manifest[section]?.[name] ?? '')?.[1] ?? []),
  );
  if ([name, ...aliases].some((identity) => RUNTIME_DEVELOPMENT_PACKAGES.test(identity)))
    return {
      effect: 'every-group',
      reason: `${name}, which the browser groups, the build or the stack load`,
    };
  if (LINT_AND_TYPE_PACKAGES.test(name))
    return { effect: 'lint-type', reason: `lint or type package ${name}` };
  return { effect: 'tooling', reason: `development tool ${name}` };
}

/** The package names whose entry differs between two dependency maps of each section. */
function changedRoots(before: Manifest, after: Manifest): string[] {
  return [
    ...new Set(
      SECTIONS.flatMap((section) => {
        const [left, right] = [before[section] ?? {}, after[section] ?? {}];
        return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
          (name) => left[name] !== right[name],
        );
      }),
    ),
  ];
}

const unreadable = (file: string): DependencyChange => ({
  effect: 'every-group',
  reason: `${file} cannot be read`,
});

const packageJsonSchema = z.record(z.string(), z.unknown());

/**
 * What a `package.json` change runs. A changed dependency counts by its package, a changed script
 * as tooling (CI runs package scripts), any other key as every group: `overrides`,
 * `patchedDependencies`, `imports` and `browserslist` change what the app resolves or builds.
 */
export function packageJsonChange(before: string, after: string): DependencyChange {
  const parse = (text: string) => {
    try {
      const json = packageJsonSchema.safeParse(JSON.parse(text));
      const manifest = manifestSchema.safeParse(json.data);
      return json.success && manifest.success ? { json: json.data, manifest: manifest.data } : undefined;
    } catch {
      return undefined;
    }
  };
  const [left, right] = [parse(before), parse(after)];
  if (!left || !right) return unreadable('package.json');
  const keys = [...new Set([...Object.keys(left.json), ...Object.keys(right.json)])].filter(
    (key) => JSON.stringify(left.json[key]) !== JSON.stringify(right.json[key]),
  );
  const changes = keys.flatMap((key): DependencyChange[] => {
    if (key === 'scripts') return [{ effect: 'tooling', reason: 'package scripts' }];
    if (!SECTIONS.some((section) => section === key))
      return [{ effect: 'every-group', reason: `package.json key ${key}` }];
    return [];
  });
  const roots = changedRoots(left.manifest, right.manifest).map((name) =>
    rootEffect(name, [left.manifest, right.manifest]),
  );
  return withFile('package.json', strongest([...changes, ...roots]));
}

const requirements = z.record(z.string(), z.unknown()).optional();
/**
 * A resolved package: `[name@version, registry, metadata, integrity]`. Another shape could hide what
 * the package installs, so it makes the lock unreadable. The metadata keeps every field, so any
 * change to it, such as `bin`, moves the package.
 */
const packageEntrySchema = z
  .tuple([
    z.string(),
    z.unknown(),
    z.looseObject({
      dependencies: requirements,
      optionalDependencies: requirements,
      peerDependencies: requirements,
    }),
  ])
  .rest(z.unknown());
type PackageEntry = z.infer<typeof packageEntrySchema>;
const lockSchema = z.object({
  workspaces: z.record(z.string(), manifestSchema),
  packages: z.record(z.string(), packageEntrySchema),
});
type Lock = z.infer<typeof lockSchema>;

const fieldsSchema = z.record(z.string(), z.unknown());
const without = (fields: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(fields).filter(([key]) => !keys.includes(key)));

/**
 * `bun.lock` with its `settings`: everything besides the resolved packages and the workspaces'
 * dependency maps, such as `overrides`, `patchedDependencies` and the lock's versions. It is JSON
 * with trailing commas; TypeScript's config reader takes both.
 */
function readLock(text: string): { lock: Lock; settings: string } | undefined {
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.parseConfigFileTextToJson('bun.lock', text);
  const parsed = lockSchema.safeParse(read.config);
  const fields = fieldsSchema.safeParse(read.config);
  const workspaces = z.record(z.string(), fieldsSchema).safeParse(fields.data?.workspaces);
  if (read.error || !parsed.success || !fields.success || !workspaces.success) return undefined;
  const settings = {
    ...without(fields.data, ['packages', 'workspaces']),
    workspaces: Object.fromEntries(
      Object.entries(workspaces.data).map(([name, entry]) => [name, without(entry, SECTIONS)]),
    ),
  };
  return { lock: parsed.data, settings: JSON.stringify(settings) };
}

/** The name a lock entry's package resolved to, without its version. */
const resolvedName = (entry: PackageEntry): string => entry[0].slice(0, entry[0].lastIndexOf('@'));

/** The names a lock entry's package goes by: its key's last segment and its resolved name. */
function packageNames(key: string, entry: PackageEntry | undefined): string[] {
  return [keySegments(key).at(-1) ?? '', entry ? resolvedName(entry) : ''].filter(Boolean);
}

/** A lock key's package names: `@scope/a/b` is `@scope/a` with its nested `b`. */
function keySegments(key: string): string[] {
  const parts = key.split('/');
  const segments: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index] ?? '';
    segments.push(part.startsWith('@') ? `${part}/${parts[++index] ?? ''}` : part);
  }
  return segments;
}

/** The lock key a dependency `name` of the package at `from` resolves to: its nearest nesting, then the top. */
function resolveKey(lock: Lock, from: string, name: string): string | undefined {
  const segments = keySegments(from);
  for (let depth = segments.length; depth >= 0; depth--) {
    const key = [...segments.slice(0, depth), name].join('/');
    if (lock.packages[key]) return key;
  }
  return undefined;
}

/**
 * Peers a package declares without loading them, by the name it resolved to, never the name it is
 * installed as: the quarantine report's parser declares `eslint`, yet never imports it
 * (node_modules/@typescript-eslint/parser/dist). Every other peer counts as loaded by its declarer.
 */
const UNLOADED_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@typescript-eslint/parser': ['eslint'],
};

/** For every lock key, the root packages whose installed tree holds it, peers included. */
function rootsByKey(lock: Lock): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const roots = new Set(SECTIONS.flatMap((section) => Object.keys(lock.workspaces['']?.[section] ?? {})));
  for (const root of roots) {
    const pending = lock.packages[root] ? [root] : [];
    const seen = new Set<string>();
    for (let key = pending.pop(); key !== undefined; key = pending.pop()) {
      if (seen.has(key)) continue;
      seen.add(key);
      owners.set(key, (owners.get(key) ?? new Set()).add(root));
      const entry = lock.packages[key];
      if (!entry) continue;
      const { dependencies, optionalDependencies, peerDependencies } = entry[2];
      const names = [
        ...Object.keys({ ...dependencies, ...optionalDependencies }),
        ...Object.keys(peerDependencies ?? {}).filter(
          (name) => !UNLOADED_PEERS[resolvedName(entry)]?.includes(name),
        ),
      ];
      for (const name of names) {
        const resolved = resolveKey(lock, key, name);
        if (resolved) pending.push(resolved);
      }
    }
  }
  return owners;
}

/**
 * What a `bun.lock` change runs: each resolved package that moved counts by the strongest root
 * package that installs it, in either version; type declarations count as lint and types, and a
 * package the browser, the build or the stack load runs every group whoever installs it. Changed
 * settings, a moved package no root installs, a changed workspace other than the root, or a lock
 * that cannot be read run every group.
 */
export function lockfileChange(before: string, after: string): DependencyChange {
  const [leftRead, rightRead] = [readLock(before), readLock(after)];
  if (!leftRead || !rightRead) return unreadable('bun.lock');
  if (leftRead.settings !== rightRead.settings)
    return { effect: 'every-group', reason: 'bun.lock: its overrides, patches or other settings changed' };
  const [left, right] = [leftRead.lock, rightRead.lock];
  const workspaces = [...new Set([...Object.keys(left.workspaces), ...Object.keys(right.workspaces)])];
  if (
    workspaces.some(
      (name) =>
        name !== '' && JSON.stringify(left.workspaces[name]) !== JSON.stringify(right.workspaces[name]),
    )
  )
    return { effect: 'every-group', reason: 'bun.lock: a workspace other than the root changed' };
  const manifests = [left.workspaces[''] ?? {}, right.workspaces[''] ?? {}];
  const roots = changedRoots(manifests[0] ?? {}, manifests[1] ?? {}).map((name) =>
    rootEffect(name, manifests),
  );
  const owners = [rootsByKey(left), rootsByKey(right)];
  const keys = [...new Set([...Object.keys(left.packages), ...Object.keys(right.packages)])];
  const moved = keys
    .filter((key) => JSON.stringify(left.packages[key]) !== JSON.stringify(right.packages[key]))
    .map((key): DependencyChange => {
      // Type declarations load nowhere at run time, whichever package declares them as a peer.
      const names = [...packageNames(key, left.packages[key]), ...packageNames(key, right.packages[key])];
      if (names.some((name) => RUNTIME_DEVELOPMENT_PACKAGES.test(name)))
        return {
          effect: 'every-group',
          reason: `${key}, which the browser groups, the build or the stack load`,
        };
      if (names.every((name) => /^@types\//.test(name)))
        return { effect: 'lint-type', reason: `${key}, type declarations only` };
      const installers = new Set(owners.flatMap((map) => [...(map.get(key) ?? [])]));
      if (!installers.size)
        return { effect: 'every-group', reason: `${key}, which no root package installs` };
      const effect = strongest([...installers].sort().map((name) => rootEffect(name, manifests)));
      return effect ? { effect: effect.effect, reason: `${key} through ${effect.reason}` } : unreadable(key);
    });
  return withFile('bun.lock', strongest([...roots, ...moved]));
}

/** The change with its file named; an unchanged file moves nothing, so it needs only Lint and the static gates. */
const withFile = (file: string, change: DependencyChange | undefined): DependencyChange =>
  change
    ? { effect: change.effect, reason: `${file}: ${change.reason}` }
    : { effect: 'lint-type', reason: `${file}: no package moved` };
