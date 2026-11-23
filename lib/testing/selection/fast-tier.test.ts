// A CI run's cheap groups are the ones its diff can break, and all of a kind when it cannot tell.
import { expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { fastTierPlan, isDocsFile, tailwindScan, UNTRACKED_IMPORTS, type FastTierGroup } from './fast-tier';

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
    everyGroupOf?: Partial<Record<'ui' | 'sql' | 'static', string>>;
    rowChanges?: string[];
    graph?: Map<string, string[]>;
    tailwindScans?: ((file: string) => boolean) | undefined;
  } = {},
): ReturnType<typeof fastTierPlan> =>
  fastTierPlan({
    groups,
    graph: options.graph ?? graph,
    changedFiles,
    fullReason: options.fullReason,
    everyGroupOf: options.everyGroupOf ?? {},
    rowChanges: options.rowChanges ?? [],
    // Tailwind scans the components here; a scanned file is covered by its own test.
    tailwindScans:
      'tailwindScans' in options ? options.tailwindScans : (file) => file.startsWith('components/'),
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

test('an unreadable diff, a full run and an every-group input take every group of every kind', () => {
  expect(selected(plan(undefined))).toEqual(EVERYTHING);
  expect(selected(plan(['docs/README.md'], { fullReason: 'Nightly run' }))).toEqual(EVERYTHING);
  const everyGroup = plan(['next.config.ts'], { fullReason: 'Every group runs for next.config.ts' });
  expect(selected(everyGroup)).toEqual(EVERYTHING);
  expect(everyGroup.reasons['sql:security']).toBe('Every group runs for next.config.ts');
});

test('a tooling input takes every group of the kinds its CI jobs run, and selects the rest by diff', () => {
  const reason = 'Tooling input changed: .github/actions/playwright/action.yml, used by components, browser';
  const action = plan(['.github/actions/playwright/action.yml'], { everyGroupOf: { ui: reason } });
  expect(selected(action)).toEqual({ ...EVERYTHING, sql: [] });
  expect(action.reasons['ui:contracts:time']).toBe(reason);
  const everyJob = { ui: 'Tooling input changed: scripts/ci/job.ts', sql: 'x', static: 'x' };
  expect(selected(plan(['scripts/ci/job.ts'], { everyGroupOf: everyJob }))).toEqual(EVERYTHING);
  // A lint or type package beside documentation still runs every static gate.
  expect(
    plan(['docs/README.md'], { everyGroupOf: { static: 'Lint or type packages moved' } }).static,
  ).toEqual(EVERY_GATE);
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

test('a file Tailwind scans for class names runs every component area, as does any file when the scan is unknown', () => {
  const scans = (file: string): boolean => file.startsWith('lib/') && !file.startsWith('lib/testing/');
  // Tailwind reads Markdown under its sources too.
  for (const file of ['lib/jobs/actions.ts', 'lib/invoicing/README.md'])
    expect(plan([file], { tailwindScans: scans }).components, file).toEqual(EVERYTHING.components);
  for (const file of ['lib/testing/runner/heavy-slot.ts', 'scripts/check-docs.ts', 'docs/README.md'])
    expect(plan([file], { tailwindScans: scans }).components, file).toEqual([]);
  for (const file of ['scripts/check-docs.ts', 'docs/README.md'])
    expect(plan([file], { tailwindScans: undefined }).components, file).toEqual(EVERYTHING.components);
});

const repositoryRoot = resolve(import.meta.dir, '../../..');
const NONE = "@import 'tailwindcss' source(none);\n";
const scan = async (css: string): Promise<(file: string) => boolean> => {
  const scans = await tailwindScan(css, repositoryRoot);
  if (!scans) throw new Error('The stylesheet declares its sources, so its scan is known');
  return scans;
};

test("a file counts as scanned exactly when Tailwind's own scanner reads it, an explicit file inside an excluded directory included", async () => {
  const explicit = await scan(
    `${NONE}@source '../lib';\n@source not '../lib/testing/';\n@source '../lib/testing/selection/test-titles.test.ts';`,
  );
  expect(explicit('lib/testing/selection/test-titles.test.ts')).toBe(true);
  expect(explicit('lib/testing/selection/fast-tier.ts')).toBe(false);
  expect(explicit('lib/zod.ts')).toBe(true);
  expect(plan(['lib/testing/selection/test-titles.test.ts'], { tailwindScans: explicit }).components).toEqual(
    EVERYTHING.components,
  );
  // A directory source inside an excluded directory stays excluded, unlike a file source. The rule
  // differs between Tailwind versions, so the planner asks the installed scanner.
  const nested = await scan(
    `${NONE}@source '../lib';\n@source not '../lib/testing';\n@source '../lib/testing/selection';`,
  );
  expect(nested('lib/testing/selection/test-titles.test.ts')).toBe(false);
  // A trailing slash, a last directive without a semicolon, a comment and an exclusion outside the repository change nothing.
  for (const css of [
    `${NONE}@source "../lib/";`,
    `${NONE}@source "../lib"`,
    `${NONE}@source '../lib';\n/* @source not '../lib/zod.ts'; */`,
    `${NONE}@source "../lib"; @source not "../../sibling-dir";`,
  ]) {
    const scans = await scan(css);
    expect(scans('lib/zod.ts'), css).toBe(true);
    expect(scans('scripts/ci-plan.ts'), css).toBe(false);
  }
  // An inline list scans no file.
  expect((await scan(`${NONE}@source inline('p-4');`))('lib/zod.ts')).toBe(false);
  const real = await scan(readFileSync(resolve(repositoryRoot, 'app/globals.css'), 'utf8'));
  expect(real('components/ui/button.tsx')).toBe(true);
  expect(real('lib/testing/selection/fast-tier.ts')).toBe(false);
  expect(real('scripts/ci-plan.ts')).toBe(false);
});

test('a file the change deleted counts as scanned when a source would reach it, whatever its exclusions', async () => {
  const scans = await scan(`${NONE}@source '../lib';\n@source not '../lib/testing';`);
  expect(scans('lib/jobs/deleted-module.ts')).toBe(true);
  expect(scans('lib/testing/deleted-helper.ts')).toBe(true);
  expect(scans('notes/deleted-page.md')).toBe(false);
  // A glob reaches every file under its fixed prefix.
  const glob = await scan(`${NONE}@source '../{lib,app}';`);
  expect(glob('lib/zod.ts')).toBe(true);
  expect(glob('notes/deleted-page.md')).toBe(true);
});

test('automatic detection, or a stylesheet that does not compile, counts every file as scanned', async () => {
  expect(await tailwindScan("@import 'tailwindcss';\n@source '../lib';", repositoryRoot)).toBeUndefined();
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await tailwindScan(`${NONE}.broken { @apply not-a-utility; }`, repositoryRoot)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
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
