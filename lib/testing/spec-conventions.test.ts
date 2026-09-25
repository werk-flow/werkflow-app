import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  berlinDateAtOffset,
  dispatchOverviewBerlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from '../../tests/golden/support/date-ownership';
import { requireChainedValue } from '../../tests/golden/support/preconditions';

// Meta-test over the browser spec files (enforcement ladder Tier 2, Stage C
// 2026-08-29): the structural testing.md conventions that ESLint cannot
// express. It reads the spec sources as text — Playwright specs never run
// under Bun's test runner (bunfig.toml scopes it to lib/), so a static scan
// is the only in-repo check that runs on every `bun run test:unit`.

const REPO_ROOT = join(import.meta.dir, '..', '..');
const GOLDEN_DIR = join(REPO_ROOT, 'tests', 'golden');
const AUDIT_DIR = join(REPO_ROOT, 'tests', 'audit');

// Golden slice specs ship stage-split since P1-16 (testing.md conventions:
// "Every new Golden slice spec ships stage-split — one monolithic slice test
// is a review flag"). Earlier specs predate the convention and stay exempt.
const FIRST_STAGED_SLICE = 16;

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

// Every spec carries at least one negative assertion. This is a structural
// backstop only: review still verifies whether that assertion proves the
// intended role/organization boundary or absence of side effects.
const NEGATIVE_CHECK_FORMS = [
  /toHaveCount\(0[,)]/,
  /not\.toBeVisible\(/,
  /toBeHidden\(/,
  /toBe\(0\)/,
  /toEqual\(0\)/,
  /toHaveLength\(0\)/,
];

describe('browser spec conventions (testing.md)', () => {
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

  test('chained-precondition errors carry the exact recovery command', () => {
    expect(() =>
      requireChainedValue('', {
        test: 'A1-09',
        needs: 'the app-assigned value created by A1-01',
        grep: 'A1-01|A1-09',
        suite: 'audit',
      })
    ).toThrow(
      'Chained precondition missing for A1-09: the app-assigned value created by A1-01. ' +
        'Earlier tests in this file create that state — run the chain in one world: ' +
        'bun run test:audit:focused --grep "A1-01|A1-09" (focused diagnostic lane; acceptance evidence comes from bun run test:verify --group <owning group>). ' +
        '(Without the chain the test would otherwise fail after minutes on a misleading locator timeout.)'
    );
  });

  test('audit date ownership accepts owned offsets and rejects foreign ones', () => {
    expect(ownedBerlinDateAtOffset('a2-kunden', 25)).toBe(berlinDateAtOffset(25));
    expect(() => ownedBerlinDateAtOffset('a2-kunden', 30)).toThrow(
      'Spec "a2-kunden" claimed run-day offset +30 for a uniqueness-constrained fixture, but owns only +25…+29, +66'
    );
  });

  test('dispatch overview dates stay inside the panel window', () => {
    expect(dispatchOverviewBerlinDateAtOffset(7)).toBe(berlinDateAtOffset(7));
    expect(() => dispatchOverviewBerlinDateAtOffset(15)).toThrow(
      'Dispatch overview offset must be an integer from 0 through 14; received 15.'
    );
  });

  test('live correction fixtures own a past date rather than future worked time', () => {
    expect(ownedBerlinDateAtOffset('performance-calendar-live', -7)).toBe(berlinDateAtOffset(-7));
    expect(() => ownedBerlinDateAtOffset('performance-calendar-live', 131)).toThrow();
  });

  test('found the spec inventory', () => {
    expect(goldenSpecs.length).toBeGreaterThanOrEqual(18);
    expect(auditSpecs.length).toBeGreaterThanOrEqual(12);
  });

  for (const path of [...goldenSpecs, ...auditSpecs]) {
    const source = readFileSync(path, 'utf8');
    const name = specName(path);

    test(`${name} runs every test in file order and continues after a failure`, () => {
      // Serial mode stopped a file at its first failure, so a spec revealed one
      // failure per run (P1-24a campaign, 2026-09-24). Tests run in declaration
      // order on one worker; a dependent test guards its producer's state with
      // a chained precondition and fails fast when that state is missing.
      expect(source).not.toMatch(/test\.describe\.configure\(/);
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
      expect(offenders, 'root the outer locator in main instead and keep the has: chain relative').toEqual([]);
    });

    test(`${name} contains at least one negative assertion`, () => {
      expect(
        NEGATIVE_CHECK_FORMS.some((form) => form.test(source))
      ).toBe(true);
    });
  }

  for (const path of goldenSpecs) {
    const name = specName(path);
    const sliceMatch = /p1-(\d+)\.spec\.ts$/.exec(name);
    if (!sliceMatch) continue;
    const sliceNumber = Number(sliceMatch[1]);
    if (sliceNumber < FIRST_STAGED_SLICE) continue;
    const source = readFileSync(path, 'utf8');

    test(`${name} is stage-split with per-stage grep tags`, () => {
      const stageTags = new Set(
        source.match(new RegExp(`@P1-${sliceNumber}-stage-[a-z-]+`, 'g')) ?? []
      );
      expect(stageTags.size).toBeGreaterThanOrEqual(2);
    });
  }

  for (const path of auditSpecs) {
    const source = readFileSync(path, 'utf8');
    const name = specName(path);

    test(`${name} carries an audit grep tag`, () => {
      // Cross-wave audits name their purpose instead of claiming a wave.
      expect(source).toMatch(/@AUDIT-(W\d|LAYOUT|SECURITY|PERFORMANCE)(?:-|\b)/);
    });
  }
});
