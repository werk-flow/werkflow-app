// Rule test: each test prepares its own preconditions and shares no state with another test.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  berlinDateAtOffset,
  dispatchOverviewBerlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from '../../../tests/golden/support/date-ownership';
import { specIndependenceProblems } from './spec-independence';

// Meta-test over the browser spec files (enforcement ladder Tier 2, Stage C
// 2026-08-29): the structural testing.md conventions that ESLint cannot
// express. It reads the spec sources as text — Playwright specs never run
// under Bun's test runner (bunfig.toml scopes it to lib/), so a static scan
// is the only in-repo check that runs on every `bun run test:unit`.

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const GOLDEN_DIR = join(REPO_ROOT, 'tests', 'golden');
const AUDIT_DIR = join(REPO_ROOT, 'tests', 'audit');
const CANARY_DIR = join(REPO_ROOT, 'tests', 'canary');

function listSpecFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => join(directory, name));
}

function specName(path: string): string {
  return path.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
}

const goldenSpecs = listSpecFiles(GOLDEN_DIR);
const auditSpecs = listSpecFiles(AUDIT_DIR);
const canarySpecs = listSpecFiles(CANARY_DIR);
const serialConfiguration = /test\s*\.\s*describe\s*\.\s*configure\s*\(\s*\{[^}]*\bmode\s*:\s*['"]serial['"]/;

describe('independence detector', () => {
  const problemsOf = (source: string): string[] => specIndependenceProblems(source, 'fixture.spec.ts');
  test('rejects a declared producer, a chained value and a checkpoint handoff', () => {
    expect(
      problemsOf(`test('b', { annotation: { type: 'requires-test', description: 'a' } }, async () => {});`),
    ).toHaveLength(1);
    expect(problemsOf(`test('b', async () => { requireChainedValue(x, y); });`)).toHaveLength(1);
    expect(problemsOf(`test('a', async () => { saveAuditCheckpoint('k', 1); });`)).toHaveLength(1);
  });
  test('rejects module state that one test writes and another reads', () => {
    expect(problemsOf(`let jobNumber = '';`)).toHaveLength(1);
    expect(
      problemsOf(`const created = new Map(); test('a', async () => { created.set('k', 1); });`),
    ).toHaveLength(1);
    expect(problemsOf(`const state = { id: '' }; test('a', async () => { state.id = 'x'; });`)).toHaveLength(
      1,
    );
    expect(problemsOf(`const ids = []; function remember(id) { ids.push(id); }`)).toHaveLength(1);
  });
  test('accepts constant tables and per-test locals that reuse a module name', () => {
    expect(
      problemsOf(`const routes = ['/a', '/b']; test('a', async () => { for (const r of routes) void r; });`),
    ).toEqual([]);
    expect(
      problemsOf(`const ids = ['x']; test('a', async () => { const ids = []; ids.push('y'); });`),
    ).toEqual([]);
  });
  test('rejects the wall clock at module load and accepts it inside a test', () => {
    expect(problemsOf(`const today = new Date().toISOString();`)).toHaveLength(1);
    expect(problemsOf(`const started = Date.now();`)).toHaveLength(1);
    expect(problemsOf(`const fixed = new Date('2026-01-01T00:00:00Z');`)).toEqual([]);
    expect(problemsOf(`test('a', async () => { const started = Date.now(); void started; });`)).toEqual([]);
  });
});

describe('browser spec conventions (testing.md)', () => {
  test('no browser test depends on another test, module state or the wall clock at load', () => {
    const problems = [...goldenSpecs, ...auditSpecs, ...canarySpecs].flatMap((path) =>
      specIndependenceProblems(readFileSync(path, 'utf8'), specName(path)),
    );
    expect(problems).toEqual([]);
  });
  test('serial configuration is rejected across whitespace and property order', () => {
    for (const source of [
      'test.describe.configure({ mode: "serial" })',
      'test.describe.configure ({ mode: "serial" })',
      'test . describe . configure ( { timeout: 30000,\n mode: "serial" } )',
    ])
      expect(source).toMatch(serialConfiguration);
    expect('test.describe.configure({ mode: "parallel" })').not.toMatch(serialConfiguration);
    expect('test.describe.configure({ timeout: 30000 })').not.toMatch(serialConfiguration);
  });
  test('seed cleanup cannot discover users or organizations by a global test marker', () => {
    const source = readFileSync(join(GOLDEN_DIR, 'support', 'seed.ts'), 'utf8');
    expect(source).not.toContain('destroyLeftoverTestWorlds');
    expect(source).not.toMatch(/\.(?:like|ilike)\(\s*['"]email['"]/);
    const organizationQueries = source.match(/\.from\(['"]organizations['"]\)[^;]+;/g) ?? [];
    expect(organizationQueries.length).toBeGreaterThan(0);
    for (const query of organizationQueries) {
      if (query.includes('name.like.')) {
        expect(query).toMatch(/\.in\(['"]admin_id['"],\s*userIds\)/);
      }
    }
  });

  test('audit date ownership accepts owned offsets and rejects foreign ones', () => {
    expect(ownedBerlinDateAtOffset('a2-stammdaten', 25)).toBe(berlinDateAtOffset(25));
    expect(() => ownedBerlinDateAtOffset('a2-stammdaten', 27)).toThrow(
      'Spec "a2-stammdaten" claimed run-day offset +27 for a uniqueness-constrained fixture, but owns only +25…+26',
    );
  });

  test('dispatch overview dates stay inside the panel window', () => {
    expect(dispatchOverviewBerlinDateAtOffset(7)).toBe(berlinDateAtOffset(7));
    expect(() => dispatchOverviewBerlinDateAtOffset(15)).toThrow(
      'Dispatch overview offset must be an integer from 0 through 14; received 15.',
    );
  });

  test('live correction fixtures own a past date rather than future worked time', () => {
    expect(ownedBerlinDateAtOffset('performance-calendar-live', -7)).toBe(berlinDateAtOffset(-7));
    expect(() => ownedBerlinDateAtOffset('performance-calendar-live', 131)).toThrow();
  });

  test('found the spec inventory', () => {
    expect(goldenSpecs.length).toBeGreaterThan(0);
    expect(auditSpecs.length).toBeGreaterThan(0);
    expect(canarySpecs.length).toBeGreaterThan(0);
  });

  for (const path of [...goldenSpecs, ...auditSpecs, ...canarySpecs]) {
    const source = readFileSync(path, 'utf8');
    const name = specName(path);

    test(`${name} does not skip remaining cases after one failure`, () => {
      expect(source).not.toMatch(serialConfiguration);
    });

    test(`${name} never filters with a page-rooted main locator inside has:`, () => {
      // Playwright evaluates `has:` inside the outer element, so a chain that
      // starts at getByRole('main') can only match when main sits inside the
      // outer element; two P1-20 panels silently matched nothing (Step 3, 2026-09-13).
      const mainRooted = new Set(
        [...source.matchAll(/const (\w+) = \w+\.getByRole\(['"]main['"]\)/g)].map((match) => match[1]),
      );
      const offenders = [...source.matchAll(/has:\s*(\w+)(\.getByRole\(['"]main['"]\))?/g)]
        .filter((match) => match[2] || (match[1] !== undefined && mainRooted.has(match[1])))
        .map((match) => match[0]);
      expect(offenders, 'root the outer locator in main instead and keep the has: chain relative').toEqual(
        [],
      );
    });
  }

  for (const path of auditSpecs) {
    const source = readFileSync(path, 'utf8');
    const name = specName(path);

    test(`${name} carries an audit grep tag`, () => {
      // Cross-wave audits name their purpose instead of claiming a wave.
      expect(source).toMatch(/@AUDIT-(W\d|LAYOUT|SECURITY|PERFORMANCE|VISUAL)(?:-|\b)/);
    });
  }
});

describe('support domain modules', () => {
  // A re-export widens the importer's inputs to the re-exported module's area, so a helper edit would
  // rerun groups of another area (testing.md, "Groups and ownership").
  for (const directory of ['steps', 'db']) {
    const root = join(REPO_ROOT, 'tests', 'golden', 'support', directory);
    for (const file of readdirSync(root).filter((name) => name.endsWith('.ts'))) {
      test(`${directory}/${file} re-exports nothing`, () => {
        expect(readFileSync(join(root, file), 'utf8')).not.toMatch(/^export\s+(\*|\{[^}]*\})\s+from\s/m);
      });
    }
  }
});
