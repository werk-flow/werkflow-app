// Rule test: a shrink-only list never gains an entry or raises a ceiling against the publication base.
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  committedFileText,
  growthProblems,
  listEntries,
  SHRINK_ONLY_LISTS,
  shrinkOnlyProblems,
  type ShrinkOnlyList,
} from './shrink-only-lists';

const repositoryRoot = resolve(import.meta.dir, '../../..');
/** The trunk every pull request merges into: the merge base with it is what the change adds to. */
const PUBLICATION_REFS = ['origin/main'];
/** CI sets it from the owner's `approved: list growth` label on the pull request; nobody else sets it. */
const GROWTH_APPROVED = process.env.SHRINK_ONLY_GROWTH_APPROVED === 'true';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** The merge base with the first publication ref this clone knows; a clone with neither fails with the cause. */
function publicationBase(): string {
  for (const ref of PUBLICATION_REFS) {
    try {
      return git('merge-base', 'HEAD', ref).trim();
    } catch {
      // merge-base exits non-zero for a ref this clone lacks: try the next one.
    }
  }
  throw new Error(`This clone knows none of ${PUBLICATION_REFS.join(', ')}; run git fetch origin.`);
}

function workingTreeText(file: string): string | null {
  const path = resolve(repositoryRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

test('every registered shrink-only list is found in the working tree', () => {
  const missing = SHRINK_ONLY_LISTS.filter((list) => listEntries(list, workingTreeText(list.file)) === null);
  expect(missing.map((list) => `${list.id}: ${list.file}`)).toEqual([]);
});

test('no shrink-only list grew since the merge base with the published preview', () => {
  const base = publicationBase();
  expect(
    shrinkOnlyProblems(
      (file) => committedFileText(repositoryRoot, base, file),
      workingTreeText,
      SHRINK_ONLY_LISTS,
      { growthApproved: GROWTH_APPROVED },
    ),
    `A shrink-only list may lose entries and lower ceilings, never gain or raise them (base ${base}). Fix the code instead of widening its exception, or ask the owner (docs/technical/testing.md, "Grow a shrink-only list").`,
  ).toEqual([]);
});

const plantedRecord: ShrinkOnlyList = {
  id: 'planted record',
  file: 'lib/planted.test.ts',
  extract: { kind: 'variable', name: 'REVIEWED' },
};
const plantedCeilings: ShrinkOnlyList = {
  id: 'planted ceilings',
  file: 'eslint-rules/planted.json',
  extract: { kind: 'json', path: ['functions'] },
};
const record = (entries: string): string =>
  `const REVIEWED: Readonly<Record<string, string>> = {\n${entries}\n};\n`;
const ceilings = (value: number, extra = ''): string =>
  JSON.stringify({ functions: { 'lib/a.ts': { 'load@1': value, ...(extra ? { [extra]: 90 } : {}) } } });
const growth = (list: ShrinkOnlyList, base: string, current: string): string[] => {
  const currentEntries = listEntries(list, current);
  if (currentEntries === null) throw new Error('the planted list is missing');
  return growthProblems(list, listEntries(list, base), currentEntries);
};

test('a raised ceiling and a new entry are refused; a lowered ceiling and a removed entry pass', () => {
  expect(growth(plantedCeilings, ceilings(120), ceilings(130))).toEqual([
    'planted ceilings (eslint-rules/planted.json) raised "lib/a.ts.load@1" from 120 to 130',
  ]);
  expect(growth(plantedCeilings, ceilings(120), ceilings(120, 'save@9'))).toEqual([
    'planted ceilings (eslint-rules/planted.json) gained "lib/a.ts.save@9"',
  ]);
  expect(growth(plantedCeilings, ceilings(120), ceilings(110))).toEqual([]);
  expect(growth(plantedCeilings, ceilings(120, 'save@9'), ceilings(120))).toEqual([]);
  expect(
    growth(
      plantedRecord,
      record(`  'a.ts::load': 'one job',`),
      record(`  'a.ts::load': 'one job',\n  'b.ts::read': 'one day',`),
    ),
  ).toEqual(['planted record (lib/planted.test.ts) gained "b.ts::read"']);
  expect(
    growth(
      plantedRecord,
      record(`  'a.ts::load': 'one job',\n  'b.ts::read': 'x',`),
      record(`  'b.ts::read': 'reworded reason',`),
    ),
  ).toEqual([]);
});

test('array lists key by their identifying strings, and a setter added to an entry is growth', () => {
  const list: ShrinkOnlyList = {
    id: 'planted array',
    file: 'eslint.config.mjs',
    extract: { kind: 'variable', name: 'exceptions' },
  };
  const array = (setters: string): string =>
    `const exceptions = [\n  { file: 'a.ts', setters: [${setters}], reason: 'why' },\n];\n`;
  expect(growth(list, array(`'setA'`), array(`'setA', 'setB'`))).toEqual([
    'planted array (eslint.config.mjs) gained "a.ts.setters#setB"',
  ]);
  expect(growth(list, array(`'setA', 'setB'`), array(`'setA'`))).toEqual([]);
  // A spread into an array value hides its entries, so the owner's approval never waives it.
  const current = listEntries(list, array(`'setA', ...MORE`));
  if (current === null) throw new Error('the planted list is missing');
  expect(growthProblems(list, listEntries(list, array(`'setA'`)), current, { growthApproved: true })).toEqual(
    ['planted array (eslint.config.mjs) gained "a.ts.setters#...MORE"'],
  );
});

test('a list absent at the base starts its own baseline, a list gone from the tree is a problem, and approval waives only growth', () => {
  expect(growth(plantedRecord, '', record(`  'a.ts::load': 'one job',`))).toEqual([]);
  expect(
    shrinkOnlyProblems(
      () => null,
      () => 'const OTHER = {};\n',
      [plantedRecord],
    ),
  ).toEqual(['planted record: lib/planted.test.ts no longer holds the list; update SHRINK_ONLY_LISTS']);
  expect(
    shrinkOnlyProblems(
      () => record(`  'a.ts::load': 'one job',`),
      () => null,
      [plantedRecord],
    ),
  ).toEqual(['planted record: lib/planted.test.ts no longer holds the list; update SHRINK_ONLY_LISTS']);
  expect(
    shrinkOnlyProblems(
      () => null,
      () => null,
      [plantedRecord],
    ),
  ).toEqual([]);
  // The owner's approval waives growth, never a list that is gone.
  const grown = record(`  'a.ts::load': 'one job',\n  'b.ts::read': 'one day',`);
  expect(
    shrinkOnlyProblems(
      () => record(`  'a.ts::load': 'one job',`),
      () => grown,
      [plantedRecord],
    ),
  ).toEqual(['planted record (lib/planted.test.ts) gained "b.ts::read"']);
  expect(
    shrinkOnlyProblems(
      () => record(`  'a.ts::load': 'one job',`),
      () => grown,
      [plantedRecord],
      { growthApproved: true },
    ),
  ).toEqual([]);
  expect(
    shrinkOnlyProblems(
      () => record(`  'a.ts::load': 'one job',`),
      () => null,
      [plantedRecord],
      { growthApproved: true },
    ),
  ).toEqual(['planted record: lib/planted.test.ts no longer holds the list; update SHRINK_ONLY_LISTS']);
  // A list rewritten as a computed value is no readable list, never an empty one.
  expect(
    shrinkOnlyProblems(
      () => record(`  'a.ts::load': 'one job',`),
      () => 'const REVIEWED = Object.freeze(entries);\n',
      [plantedRecord],
    ),
  ).toEqual(['planted record: lib/planted.test.ts no longer holds the list; update SHRINK_ONLY_LISTS']);
});

test('a spread into a record list and a computed or opaque ceiling are growth', () => {
  expect(
    growth(
      plantedRecord,
      record(`  'a.ts::load': 'one job',`),
      record(`  'a.ts::load': 'one job',\n  ...MORE,`),
    ),
  ).toEqual(['planted record (lib/planted.test.ts) gained "...MORE"']);
  const list: ShrinkOnlyList = {
    id: 'waits',
    file: 'tests/timeouts.ts',
    extract: { kind: 'numeric-exports' },
  };
  expect(
    growth(list, 'export const UPLOAD_MS = 60_000;\n', 'export const UPLOAD_MS = 60 * 1000 * 2;\n'),
  ).toEqual(['waits (tests/timeouts.ts) raised "UPLOAD_MS" from 60000 to 120000']);
  expect(growth(list, 'export const UPLOAD_MS = 60_000;\n', 'export const UPLOAD_MS = slowest();\n')).toEqual(
    ['waits (tests/timeouts.ts) replaced the ceiling 60000 of "UPLOAD_MS" with a value it cannot compare'],
  ); // The owner's approval waives a raised ceiling, never a spread or a ceiling it cannot compare.
  const approved = (target: ShrinkOnlyList, base: string, current: string): string[] => {
    const currentEntries = listEntries(target, current);
    if (currentEntries === null) throw new Error('the planted list is missing');
    return growthProblems(target, listEntries(target, base), currentEntries, { growthApproved: true });
  };
  expect(approved(list, 'export const UPLOAD_MS = 60_000;\n', 'export const UPLOAD_MS = 90_000;\n')).toEqual(
    [],
  );
  expect(
    approved(list, 'export const UPLOAD_MS = 60_000;\n', 'export const UPLOAD_MS = slowest();\n'),
  ).toEqual([
    'waits (tests/timeouts.ts) replaced the ceiling 60000 of "UPLOAD_MS" with a value it cannot compare',
  ]);
  expect(
    approved(
      plantedRecord,
      record(`  'a.ts::load': 'one job',`),
      record(`  'a.ts::load': 'one job',\n  ...MORE,`),
    ),
  ).toEqual(['planted record (lib/planted.test.ts) gained "...MORE"']);
});

test('a JSON array keys by its items, so replacing one is growth', () => {
  const list: ShrinkOnlyList = {
    id: 'planted array',
    file: 'planted.json',
    extract: { kind: 'json', path: ['files'] },
  };
  expect(
    growth(list, JSON.stringify({ files: ['a.ts', 'b.ts'] }), JSON.stringify({ files: ['z.ts', 'b.ts'] })),
  ).toEqual(['planted array (planted.json) gained "z.ts"']);
  expect(
    growth(list, JSON.stringify({ files: ['a.ts', 'b.ts'] }), JSON.stringify({ files: ['b.ts'] })),
  ).toEqual([]);
});

test('the browser wait registry ratchets each exported wait', () => {
  const list: ShrinkOnlyList = {
    id: 'waits',
    file: 'tests/timeouts.ts',
    extract: { kind: 'numeric-exports' },
  };
  expect(
    growth(
      list,
      'export const UPLOAD_MS = 60_000;\n',
      'export const UPLOAD_MS = 90_000;\nexport const NEW_MS = 20_000;\n',
    ),
  ).toEqual([
    'waits (tests/timeouts.ts) raised "UPLOAD_MS" from 60000 to 90000',
    'waits (tests/timeouts.ts) gained "NEW_MS"',
  ]);
});
