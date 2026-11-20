// A CI run's cheap groups are the ones its diff can break, and all of a kind when it cannot tell.
import { expect, test } from 'bun:test';
import { compile } from '@tailwindcss/node';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import {
  fastTierPlan,
  isDocsFile,
  stylesheetScanRoots,
  UNTRACKED_IMPORTS,
  type FastTierGroup,
} from './fast-tier';

const groups: FastTierGroup[] = [
  { id: 'ui:contracts:calendar', kind: 'ui', files: ['tests/ui-contracts/calendar.spec.ts'] },
  { id: 'ui:contracts:time', kind: 'ui', files: ['tests/ui-contracts/clock.spec.ts'] },
  { id: 'unit:all', kind: 'unit', files: ['lib/jobs/status.test.ts'] },
  { id: 'sql:planning', kind: 'sql', files: ['supabase/tests/planning.sql'] },
  { id: 'sql:security', kind: 'sql', files: ['supabase/tests/security.sql'] },
  { id: 'static:lint', kind: 'static', files: ['eslint.config.mjs'] },
  { id: 'static:typecheck', kind: 'static', files: ['tsconfig.json'] },
  { id: 'static:docs', kind: 'static', files: ['scripts/check-docs.ts'] },
  { id: 'static:coverage', kind: 'static', files: ['scripts/check-test-coverage.ts'] },
  { id: 'static:dependencies', kind: 'static', files: ['bun.lock'] },
  { id: 'audit:wave-1:a5', kind: 'audit', files: ['tests/audit/wave-1/a5.spec.ts'] },
];
// The contract bundle reaches the calendar board; the clock spec imports a product helper of its own.
const graph = new Map<string, string[]>([
  ['tests/ui-contracts/run.ts', ['lib/testing/runner/workspace-test-lock.ts']],
  ['tests/ui-contracts/fixture.tsx', ['tests/ui-contracts/calendar-boundaries.tsx']],
  ['tests/ui-contracts/calendar-boundaries.tsx', ['components/kalender/board.tsx']],
  ['components/kalender/board.tsx', ['components/ui/button.tsx']],
  ['tests/ui-contracts/calendar.spec.ts', ['tests/ui-contracts/open-fixture.ts']],
  ['tests/ui-contracts/clock.spec.ts', ['lib/time-tracking/business-day.ts']],
  ['scripts/seed-demo-data.ts', ['lib/personnel/holidays.ts']],
  ['scripts/run-sql-assertions.ts', ['lib/testing/selection/sql-assertion-files.ts']],
]);

const plan = (
  changedFiles: readonly string[] | undefined,
  options: {
    fullReason?: string;
    rowChanges?: string[];
    graph?: Map<string, string[]>;
    stylesheet?: { include: string[]; exclude: string[] } | undefined;
  } = {},
): ReturnType<typeof fastTierPlan> =>
  fastTierPlan({
    groups,
    graph: options.graph ?? graph,
    changedFiles,
    fullReason: options.fullReason,
    rowChanges: options.rowChanges ?? [],
    // Tailwind scans the components here; a scanned file is covered by its own test.
    stylesheet: 'stylesheet' in options ? options.stylesheet : { include: ['components'], exclude: [] },
  });
const selected = (result: ReturnType<typeof fastTierPlan>): Record<string, string[]> => ({
  components: result.components,
  unit: result.unit,
  sql: result.sql,
  static: result.static,
  lint: result.lint,
});
const EVERY_GATE = ['static:typecheck', 'static:docs', 'static:coverage', 'static:dependencies'];
const EVERYTHING = {
  components: ['ui:contracts:calendar', 'ui:contracts:time'],
  unit: ['unit:all'],
  sql: ['sql:planning', 'sql:security'],
  static: EVERY_GATE,
  lint: ['static:lint'],
};

test('an unreadable diff, a full run and a tooling change take every group of every kind', () => {
  expect(selected(plan(undefined))).toEqual(EVERYTHING);
  expect(selected(plan(['docs/README.md'], { fullReason: 'Nightly run' }))).toEqual(EVERYTHING);
  const tooling = plan(['bun.lock'], { fullReason: 'Tooling input changed: bun.lock' });
  expect(selected(tooling)).toEqual(EVERYTHING);
  expect(tooling.reasons['sql:security']).toBe('Tooling input changed: bun.lock');
});

test('a diff of documentation alone runs the gates that read it, the dependency audit, Lint and the unit suite, and no component or SQL group', () => {
  const docs = [
    'docs/technical/testing.md',
    'AGENTS.md',
    '.claude/skills/file-pr/SKILL.md',
    'docs/media/flow.png',
  ];
  expect(docs.every(isDocsFile)).toBe(true);
  expect(selected(plan(docs))).toEqual({
    components: [],
    unit: ['unit:all'],
    sql: [],
    static: ['static:docs', 'static:coverage', 'static:dependencies'],
    lint: ['static:lint'],
  });
  // Code under docs/ or .claude/ is no documentation, nor is anything a formatter or build reads.
  expect(plan(['docs/examples.jsonc']).static).toEqual(EVERY_GATE);
  for (const file of [
    '.claude/hooks/refuse-heavy-commands.ts',
    '.claude/settings.json',
    'docs/schema.sql',
    'docs/examples.jsonc',
    'docs/diagram.yaml',
  ])
    expect(isDocsFile(file)).toBe(false);
});

test('every other plan keeps every static gate, Lint and the unit suite', () => {
  for (const changed of [[], ['lib/jobs/status.ts'], ['docs/README.md', 'lib/jobs/status.ts']]) {
    const result = plan(changed);
    expect(result.static).toEqual(EVERY_GATE);
    expect(result.lint).toEqual(['static:lint']);
    expect(result.unit).toEqual(['unit:all']);
  }
});

test('a change the contract bundle, its runner or support reaches runs every component area', () => {
  for (const file of [
    'components/ui/button.tsx',
    'tests/ui-contracts/fixture.tsx',
    'tests/ui-contracts/open-fixture.ts',
    'tests/ui-contracts/playwright.config.ts',
    'lib/testing/runner/workspace-test-lock.ts',
    'app/globals.css',
  ])
    expect(plan([file]).components, file).toEqual(EVERYTHING.components);
});

test('a file Tailwind scans for class names runs every component area, as does any file when the scan is not declared', () => {
  const scan = { include: ['app', 'lib', 'proxy.ts'], exclude: ['lib/testing'] };
  for (const file of ['app/manifest.ts', 'lib/jobs/actions.ts', 'proxy.ts'])
    expect(plan([file], { stylesheet: scan }).components, file).toEqual(EVERYTHING.components);
  for (const file of ['lib/testing/runner/heavy-slot.ts', 'scripts/check-docs.ts', 'proxy.tsx'])
    expect(plan([file], { stylesheet: scan }).components, file).toEqual([]);
  expect(plan(['scripts/check-docs.ts'], { stylesheet: undefined }).components).toEqual(
    EVERYTHING.components,
  );
  // Tailwind reads Markdown under its sources too; an unknown scan may reach any file.
  expect(plan(['lib/invoicing/README.md'], { stylesheet: scan }).components).toEqual(EVERYTHING.components);
  expect(plan(['docs/README.md'], { stylesheet: scan }).components).toEqual([]);
  expect(plan(['docs/README.md'], { stylesheet: undefined }).components).toEqual(EVERYTHING.components);
  // A source at or above the repository root scans every file.
  for (const include of [[''], ['..']])
    expect(
      plan(['scripts/style-candidates.ts'], { stylesheet: { include, exclude: [] } }).components,
    ).toEqual(EVERYTHING.components);
});

test("the stylesheet's scan roots are the sources Tailwind's compiler resolves, less its negated paths inside the repository", async () => {
  const root = resolve(import.meta.dir, '../../..');
  const roots = async (css: string): Promise<ReturnType<typeof stylesheetScanRoots>> =>
    stylesheetScanRoots(await compile(css, { base: resolve(root, 'app'), onDependency() {} }), root);
  const none = "@import 'tailwindcss' source(none);\n";
  expect(await roots(`${none}@source '.';\n@source '../lib';\n@source not '../lib/testing';`)).toEqual({
    include: ['app', 'lib'],
    exclude: ['lib/testing'],
  });
  // A trailing slash, a last directive without a semicolon, and a comment change nothing.
  for (const css of [
    `${none}@source "../lib/";`,
    `${none}@source "../lib"`,
    `${none}@source '../lib';\n/* @source not '../lib/jobs'; */`,
  ])
    expect(await roots(css), css).toEqual({ include: ['lib'], exclude: [] });
  // An exclusion outside the repository excludes no file of it.
  const sibling = await roots(`${none}@source "../lib"; @source not "../../sibling-dir";`);
  expect(plan(['lib/invoicing/rules/NOTICE.txt'], { stylesheet: sibling }).components).toEqual(
    EVERYTHING.components,
  );
  // A glob may scan any file, and automatic detection scans what it finds: both count every file.
  expect(await roots(`${none}@source '../{lib,app}';`)).toBeUndefined();
  expect(await roots("@import 'tailwindcss';\n@source '../lib';")).toBeUndefined();
  // An inline list scans no file.
  expect(await roots(`${none}@source inline('p-4');`)).toEqual({ include: [], exclude: [] });
  const real = await roots(readFileSync(resolve(root, 'app/globals.css'), 'utf8'));
  expect(real?.include).toEqual(expect.arrayContaining(['app', 'components', 'lib']));
});

test('a component area runs for its own spec and what only that spec imports, and for no other file', () => {
  expect(plan(['tests/ui-contracts/clock.spec.ts']).components).toEqual(['ui:contracts:time']);
  expect(plan(['lib/time-tracking/business-day.ts']).components).toEqual(['ui:contracts:time']);
  expect(plan(['tests/ui-contracts/calendar.spec.ts']).components).toEqual(['ui:contracts:calendar']);
  expect(plan(['lib/jobs/actions.ts', 'tests/audit/wave-1/a5.spec.ts']).components).toEqual([]);
});

test('an unresolved import takes every component area when the bundle reaches it, and its own area when a spec does', () => {
  const bundle = new Map(graph);
  bundle.set('components/kalender/board.tsx', [UNKNOWN_IMPORT_DEPENDENCY]);
  expect(plan(['lib/jobs/actions.ts'], { graph: bundle }).components).toEqual(EVERYTHING.components);
  // An import loads a module, never documentation.
  expect(plan(['docs/README.md'], { graph: bundle }).components).toEqual([]);
  const spec = new Map(graph);
  spec.set('lib/time-tracking/business-day.ts', [UNKNOWN_IMPORT_DEPENDENCY]);
  expect(plan(['lib/jobs/actions.ts'], { graph: spec }).components).toEqual(['ui:contracts:time']);
  // The gitignored private reader is no unknown: no diff can change it.
  const untracked = new Map(graph);
  untracked.set('components/kalender/board.tsx', ['lib/inventory/wholesaler-reader.ts']);
  untracked.set('lib/inventory/wholesaler-reader.ts', [UNKNOWN_IMPORT_DEPENDENCY]);
  expect(plan(['lib/jobs/actions.ts'], { graph: untracked }).components).toEqual([]);
});

test("a SQL group runs for its own assertions, and every SQL group for the schema, the generated types or the SQL job's scripts", () => {
  expect(plan(['supabase/tests/planning.sql']).sql).toEqual(['sql:planning']);
  for (const file of [
    'supabase/migrations/20261120000000_planning.sql',
    'supabase/tests/helpers.sql',
    'lib/supabase/database.types.ts',
    'lib/personnel/holidays.ts',
    'lib/testing/selection/sql-assertion-files.ts',
  ])
    expect(plan([file]).sql, file).toEqual(EVERYTHING.sql);
  expect(plan(['lib/jobs/actions.ts', 'components/ui/button.tsx', 'supabase/README.md']).sql).toEqual([]);
});

test('a change inside the rows of a group registry runs every component area and every SQL group', () => {
  for (const registry of [
    'lib/testing/selection/test-groups.ts',
    'lib/testing/selection/component-areas.ts',
  ]) {
    const result = plan([registry], { rowChanges: [registry] });
    expect(result.components).toEqual(EVERYTHING.components);
    expect(result.sql).toEqual(EVERYTHING.sql);
  }
  expect(plan(['lib/testing/selection/dialog-inventory.ts']).sql).toEqual([]);
});

test('the one unresolved import of each untracked importer is its gitignored private code', () => {
  const root = resolve(import.meta.dir, '../../..');
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n'));
  for (const [file, specifier] of Object.entries(UNTRACKED_IMPORTS)) {
    const source = readFileSync(resolve(root, file), 'utf8');
    // A dynamic import or require could load any file, so it voids the exception.
    expect(source).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
    const resolves = (name: string): boolean => {
      if (!name.startsWith('.') && !name.startsWith('@/')) return true;
      const base = name.startsWith('@/') ? name.slice(2) : posix.join(dirname(file), name);
      return ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].some((suffix) => tracked.has(`${base}${suffix}`));
    };
    const names = [...source.matchAll(/\b(?:from|import)\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );
    expect(names.filter((name) => !resolves(name))).toEqual([specifier]);
    const path = `${specifier.replace('@/', '')}.ts`;
    expect(execFileSync('git', ['check-ignore', path], { cwd: root, encoding: 'utf8' }).trim()).toBe(path);
  }
});
