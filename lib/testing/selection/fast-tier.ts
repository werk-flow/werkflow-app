import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';

/** A component, unit, SQL or static group as the fast tier sees it. */
export type FastTierGroup = { id: string; kind: string; files: readonly string[] };

/** The cheap groups a CI run executes beside its browser shards, with the reason for each. */
export type FastTierPlan = {
  components: string[];
  unit: string[];
  sql: string[];
  /** The static gates except `static:lint`, which runs in its own job. */
  static: string[];
  lint: string[];
  reasons: Record<string, string>;
};

const LINT = 'static:lint';
/**
 * The static gates a documentation-only diff runs: those that read documentation (`docs:check`, and
 * `test:coverage`, which reads the flow catalog), and the dependency audit, which decision 0009
 * runs on every CI run because an advisory can appear without any change.
 */
const DOCS_GATES = ['static:docs', 'static:coverage', 'static:dependencies'];
/**
 * Prose no build, bundle, database, formatter or component reads: Markdown anywhere, and plain text
 * and images under `docs/` and `.claude/`. Any other file is code, whatever its folder.
 */
export function isDocsFile(file: string): boolean {
  return (
    /\.mdx?$/.test(file) ||
    ((file.startsWith('docs/') || file.startsWith('.claude/')) && /\.(?:txt|png|jpe?g|gif|webp)$/.test(file))
  );
}

/**
 * Modules whose one unresolved import is gitignored private code under `vendor/`, which no diff can
 * change and no CI checkout holds; the contract bundle swaps it for a stand-in. Every other
 * unresolved import counts as unknown (fast-tier.test.ts holds the exception to its import).
 */
export const UNTRACKED_IMPORTS: Readonly<Record<string, string>> = {
  'lib/inventory/wholesaler-reader.ts': '@/vendor/wholesaler-reader/src/index',
};

const repositoryPath = (repositoryRoot: string, path: string): string =>
  relative(repositoryRoot, path).split(sep).join('/');
const inRepository = (root: string): boolean => root !== '' && root !== '..' && !root.startsWith('../');
/** Whether `root` holds `file`; the repository root, or a root above it, holds every file. */
const holds = (root: string, file: string): boolean =>
  !inRepository(root) || file === root || file.startsWith(`${root}/`);

/**
 * Whether Tailwind scans a repository file for class names under `stylesheet` (the text of
 * `app/globals.css`), as the contract runner compiles and scans it. A scanned file, Markdown
 * included, can change the stylesheet every contract renders with, even outside the bundle (a
 * class name built at run time). Tailwind's installed scanner says which files it reads: an explicit
 * file inside an excluded directory, for one, and the rule differs between Tailwind versions. A file the change deleted counts as scanned when any
 * source's fixed path holds it, whatever the exclusions. Undefined, so every file counts as
 * scanned, when automatic detection stays on or the stylesheet does not compile.
 */
export async function tailwindScan(
  stylesheet: string,
  repositoryRoot: string,
): Promise<((file: string) => boolean) | undefined> {
  let compiled: Awaited<ReturnType<typeof compile>>;
  try {
    compiled = await compile(stylesheet, { base: join(repositoryRoot, 'app'), onDependency() {} });
  } catch (error) {
    console.warn(
      `[fast-tier] app/globals.css does not compile, so every file counts as scanned: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
  if (compiled.root !== 'none') return undefined;
  const scanned = new Set(
    new Scanner({ sources: compiled.sources }).files.map((file) => repositoryPath(repositoryRoot, file)),
  );
  const sourceRoots = compiled.sources
    .filter((source) => !source.negated)
    .map((source) => {
      const glob = source.pattern.search(/[*?{}[\]]/);
      const fixed =
        glob < 0 ? source.pattern : source.pattern.slice(0, source.pattern.lastIndexOf('/', glob) + 1);
      return repositoryPath(repositoryRoot, resolve(source.base, fixed));
    });
  return (file) =>
    scanned.has(file) ||
    (!existsSync(join(repositoryRoot, file)) && sourceRoots.some((root) => holds(root, file)));
}

/** What running `roots` loads through imports, product code included, and whether an import was unresolved. */
export function closure(
  graph: ReadonlyMap<string, readonly string[]>,
  roots: readonly string[],
): { files: Set<string>; unresolved: boolean } {
  const files = new Set<string>();
  let unresolved = false;
  const pending = [...roots];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) continue;
    files.add(file);
    for (const dependency of graph.get(file) ?? []) {
      if (dependency !== UNKNOWN_IMPORT_DEPENDENCY) pending.push(dependency);
      else if (!Object.hasOwn(UNTRACKED_IMPORTS, file)) unresolved = true;
    }
  }
  return { files, unresolved };
}

/**
 * The contract runner and the bundle it builds for every area. The bundle mounts and initializes
 * every boundary at load, and a spec opens its fixture by name, not by import, so whatever the
 * bundle reaches can break any area.
 */
const CONTRACT_HARNESS = ['tests/ui-contracts/run.ts', 'tests/ui-contracts/fixture.tsx'];
/** What the SQL job runs besides the assertions: the SQL runner, the generated types' check and the demo seeder. */
const SQL_HARNESS = [
  'scripts/run-sql-assertions.ts',
  'scripts/generate-supabase-types.ts',
  'scripts/seed-demo-data.ts',
];
const GENERATED_TYPES = 'lib/supabase/database.types.ts';
/** The registries whose rows define the SQL groups and the component areas (ci-plan.ts, `REGISTRY_ROWS`). */
const GROUP_REGISTRIES = ['lib/testing/selection/test-groups.ts', 'lib/testing/selection/component-areas.ts'];

/**
 * Which component, unit, SQL and static groups a CI run needs for its diff, as `test:verify`
 * decides locally from their inputs. It fails open: an unreadable diff or a full run
 * (`fullReason`) takes every group, and a tooling input every group of the kinds its jobs run
 * (`everyGroupOf`). Component areas run for their own specs, and all of
 * them for a change the contract runner or bundle reaches, any stylesheet or file Tailwind scans,
 * the contracts' support, or an unresolved import. SQL groups run for their own files, and all of them for any other
 * change under `supabase/`, the generated types or the SQL job's scripts. The unit suite runs in
 * every plan, because its convention tests read the repository at run time. The static gates run
 * in every plan; a diff of documentation alone runs only those that read it, the dependency audit
 * and Lint.
 */
export function fastTierPlan(input: {
  groups: readonly FastTierGroup[];
  graph: ReadonlyMap<string, readonly string[]>;
  /** The files the change touches, or undefined when the diff could not be read. */
  changedFiles: readonly string[] | undefined;
  /** Why the browser plan runs every group (ci-plan.ts), or undefined. */
  fullReason: string | undefined;
  /** The kinds a tooling input takes whole, with the reason (ci-plan.ts, `toolingClass`). */
  everyGroupOf: Readonly<Partial<Record<'ui' | 'sql' | 'static', string>>>;
  /** The changed registries whose change stays inside their rows. */
  rowChanges: readonly string[];
  /** `tailwindScan` of `app/globals.css`; undefined counts every file as scanned. */
  tailwindScans: ((file: string) => boolean) | undefined;
}): FastTierPlan {
  const reasons: Record<string, string> = {};
  const take = (groups: readonly FastTierGroup[], reason: string): void => {
    for (const group of groups) reasons[group.id] ??= reason;
  };
  const ofKind = (kind: string): FastTierGroup[] => input.groups.filter((group) => group.kind === kind);
  const changed = input.changedFiles;
  const lint = input.groups.filter((group) => group.id === LINT);
  const gates = ofKind('static').filter((group) => group.id !== LINT);
  take(ofKind('unit'), 'Unit suite: its convention tests read the repository at run time');
  take(lint, 'Lint runs in every plan');
  if (changed === undefined || input.fullReason !== undefined) {
    const reason = input.fullReason ?? 'The diff against the base could not be read';
    for (const kind of ['ui', 'sql']) take(ofKind(kind), reason);
    take(gates, reason);
  } else {
    for (const [kind, reason] of Object.entries(input.everyGroupOf))
      take(kind === 'static' ? gates : ofKind(kind), reason);
    const docsOnly = changed.length > 0 && changed.every(isDocsFile);
    take(
      docsOnly ? gates.filter((group) => DOCS_GATES.includes(group.id)) : gates,
      docsOnly ? 'Documentation changed' : 'Static gates run in every plan',
    );
    // Tailwind reads Markdown under its sources too.
    const scans = input.tailwindScans;
    const restyled = changed.find((file) => !scans || scans(file));
    if (restyled) take(ofKind('ui'), `Tailwind scans it for class names (${restyled})`);
    // Otherwise documentation reaches no bundle, database or component, so only code changes select them.
    const code = changed.filter((file) => !isDocsFile(file));
    const registry = input.rowChanges.find((file) => GROUP_REGISTRIES.includes(file));
    selectComponents(ofKind('ui'), input.graph, code, registry, take);
    selectSql(ofKind('sql'), input.graph, code, registry, take);
  }
  const selected = (kind: string): string[] =>
    input.groups.filter((group) => group.kind === kind && group.id in reasons).map((group) => group.id);
  return {
    components: selected('ui'),
    unit: selected('unit'),
    sql: selected('sql'),
    static: gates.filter((group) => group.id in reasons).map((group) => group.id),
    lint: lint.map((group) => group.id),
    reasons,
  };
}

type Take = (groups: readonly FastTierGroup[], reason: string) => void;

function selectComponents(
  areas: readonly FastTierGroup[],
  graph: ReadonlyMap<string, readonly string[]>,
  changed: readonly string[],
  registry: string | undefined,
  take: Take,
): void {
  const harness = closure(graph, CONTRACT_HARNESS);
  const shared = changed.find(
    (file) =>
      harness.files.has(file) ||
      (file.startsWith('tests/ui-contracts/') && !file.endsWith('.spec.ts')) ||
      file.endsWith('.css') ||
      file === registry,
  );
  // An import loads a module, never documentation, so an unresolved one matters only beside a code change.
  if (harness.unresolved && changed.length) take(areas, 'The contract bundle has an unresolved import');
  if (shared) take(areas, `Contract bundle, runner, support or stylesheet changed (${shared})`);
  for (const area of areas) {
    const own = closure(graph, area.files);
    const file = changed.find((candidate) => own.files.has(candidate));
    if (file) take([area], `Its specs or what they import changed (${file})`);
    else if (own.unresolved && changed.length) take([area], 'Its specs have an unresolved import');
  }
}

function selectSql(
  groups: readonly FastTierGroup[],
  graph: ReadonlyMap<string, readonly string[]>,
  changed: readonly string[],
  registry: string | undefined,
  take: Take,
): void {
  const harness = closure(graph, SQL_HARNESS);
  if (harness.unresolved && changed.length) take(groups, "The SQL job's scripts have an unresolved import");
  for (const file of changed) {
    const owners = groups.filter((group) => group.files.includes(file));
    if (owners.length) take(owners, `Its assertions changed (${file})`);
    else if (
      file.startsWith('supabase/') ||
      file === GENERATED_TYPES ||
      file === registry ||
      harness.files.has(file)
    )
      take(groups, `Schema, generated types or the SQL job's scripts changed (${file})`);
  }
}
