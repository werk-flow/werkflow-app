// Rule test: every catalog flow maps to evidence, and every executable reference names the test titles that prove it.
import { describe, expect, test } from 'bun:test';
import { parseCatalogFlows, validateCoverageMap, coverageMapSchema, type CoverageMap } from './coverage-map';
import type { TestGroup } from './test-groups';
import { expectDefined } from '../spec-support/expect-defined';

const catalog = parseCatalogFlows(
  '- `P1-22-F01` — Employee submits. The manager sees one request.\n\n- `P1-22-F02` — Another company cannot read it.\n',
);
const groups: TestGroup[] = [
  {
    id: 'audit:corrections',
    files: ['tests/corrections.spec.ts', 'tests/other.spec.ts'],
    kind: 'audit',
    scopes: ['time'],
    isolation: 'group-world',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  },
];
const sources: Record<string, string> = {
  'tests/corrections.spec.ts': [
    "test.describe('Corrections @AUDIT', () => {",
    "  test('C-01: employee submits once and the manager sees one request', async () => {",
    "    await test.step('The outsider reads no request', async () => {});",
    '  });',
    "  test('C-02/C-03: a resubmission keeps one request', async () => {});",
    "  test('C-03: the history keeps both revisions', async () => {});",
    '});',
  ].join('\n'),
  'tests/other.spec.ts': "test('C-09: an unrelated flow', async () => {});",
};
function mapping(): CoverageMap {
  return {
    version: 2,
    catalogHashes: Object.fromEntries(catalog.map((flow) => [flow.id, flow.hash])),
    mappings: [
      {
        id: 'correction-review',
        flowIds: catalog.map((flow) => flow.id),
        evidence: [
          {
            file: 'tests/corrections.spec.ts',
            kind: 'browser',
            description: 'Submit and exact request cardinality; outsider reads zero rows.',
            titles: ['C-01', 'The outsider reads no request'],
          },
        ],
        clauses:
          'The employee submits once. The manager sees exactly one request. Another company sees none.',
        review: { kind: 'assertions-reviewed', rationale: 'Both visible and saved outcomes are asserted.' },
      },
    ],
  };
}
function validate(coverage: CoverageMap): string[] {
  return validateCoverageMap({
    catalog,
    coverage,
    groups,
    repositoryRoot: process.cwd(),
    fileExists: () => true,
    readText: (file) => sources[file] ?? '',
  });
}
function firstReference(coverage: CoverageMap): CoverageMap['mappings'][number]['evidence'][number] {
  return expectDefined(expectDefined(coverage.mappings[0]).evidence[0]);
}
function withTitles(titles: string[], file = 'tests/corrections.spec.ts'): CoverageMap {
  const coverage = mapping();
  const reference = firstReference(coverage);
  reference.file = file;
  reference.titles = titles;
  return coverage;
}

describe('catalog coverage traceability', () => {
  test('one reviewed mapping can prove several flows without test-count equivalence', () => {
    expect(validate(mapping())).toEqual([]);
  });
  test('changing a second observable clause reopens the whole bullet', () => {
    const changed = parseCatalogFlows(
      '- `P1-22-F01` — Employee submits. The manager sees two requests.\n\n- `P1-22-F02` — Another company cannot read it.\n',
    );
    expect(
      validateCoverageMap({
        catalog: changed,
        coverage: mapping(),
        groups,
        repositoryRoot: process.cwd(),
        fileExists: () => true,
        readText: (file) => sources[file] ?? '',
      }).some((problem) => problem.includes('changed or is unreviewed: P1-22-F01')),
    ).toBe(true);
  });
  test('deleting a mapping, adding an unknown ID, and deleting its executable file fail', () => {
    const missing = mapping();
    expectDefined(missing.mappings[0]).flowIds = ['P1-22-F01', 'P1-22-F99'];
    expect(validate(missing)).toEqual(
      expect.arrayContaining([
        'Unmapped catalog flow: P1-22-F02',
        'Unknown flow P1-22-F99 in correction-review',
      ]),
    );
    expect(
      validateCoverageMap({
        catalog,
        coverage: mapping(),
        groups,
        repositoryRoot: process.cwd(),
        fileExists: () => false,
      }).some((problem) => problem.includes('Missing or unsafe evidence file')),
    ).toBe(true);
  });
  test('an inspection cannot silently replace executable coverage', () => {
    const onlyInspection = mapping();
    expectDefined(onlyInspection.mappings[0]).evidence = [
      { kind: 'inspection', file: 'docs/review.md', description: 'A reviewer looked at it.' },
    ];
    expect(
      validate(onlyInspection).some((problem) =>
        problem.startsWith('No executable evidence in correction-review'),
      ),
    ).toBe(true);
  });
  test('unsafe references and unregistered tests fail even when the file exists', () => {
    const unsafe = mapping();
    firstReference(unsafe).file = '../other-repo/test.spec.ts';
    expect(validate(unsafe).some((problem) => problem.includes('unsafe evidence'))).toBe(true);
    expect(validate(unsafe).some((problem) => problem.includes('no executable test group'))).toBe(true);
  });
  test('whole bullets, lowercase immutable IDs, and wrapped lines are hashed', () => {
    const flows = parseCatalogFlows(
      '- `P1-00a-F01` — Upload shows progress.\n  Download remains private.\n\n## Next\n',
    );
    expect(flows).toHaveLength(1);
    expect(expectDefined(flows[0]).id).toBe('P1-00a-F01');
    expect(expectDefined(flows[0]).bullet).toContain('Download remains private');
    expect(coverageMapSchema.safeParse({ ...mapping(), unnoticed: true }).success).toBe(false);
  });
});

describe('coverage evidence names its proving tests', () => {
  test('a version 1 map that names files only is refused', () => {
    expect(coverageMapSchema.safeParse({ ...mapping(), version: 1 }).success).toBe(false);
  });
  test('a missing title fails', () => {
    expect(validate(withTitles(['C-04']))).toEqual([
      'Unknown test title in correction-review: "C-04" is not declared in tests/corrections.spec.ts',
    ]);
  });
  test('a renamed test fails under its old full title', () => {
    expect(validate(withTitles(['C-01: employee submits once and the manager sees two requests']))).toEqual([
      'Unknown test title in correction-review: "C-01: employee submits once and the manager sees two requests" is not declared in tests/corrections.spec.ts',
    ]);
  });
  test('a tag carried by two tests is ambiguous; the full title resolves it', () => {
    expect(validate(withTitles(['C-03']))).toEqual([
      'Ambiguous test title in correction-review: "C-03" matches 2 titles in tests/corrections.spec.ts',
    ]);
    expect(validate(withTitles(['C-03: the history keeps both revisions']))).toEqual([]);
  });
  test('a tag only matches as a whole tag, not as a prefix', () => {
    expect(validate(withTitles(['C-0']))).toEqual([
      'Unknown test title in correction-review: "C-0" is not declared in tests/corrections.spec.ts',
    ]);
  });
  test('a title declared in another file does not prove this reference', () => {
    expect(validate(withTitles(['C-09']))).toEqual([
      'Unknown test title in correction-review: "C-09" is not declared in tests/corrections.spec.ts',
    ]);
    expect(validate(withTitles(['C-09'], 'tests/other.spec.ts'))).toEqual([]);
  });
  test('an executable reference names titles or a reason, never neither or both', () => {
    const neither = mapping();
    delete firstReference(neither).titles;
    const both = withTitles(['C-01']);
    firstReference(both).unmatched = 'The file proves no clause of this ledger row.';
    const message =
      'Evidence tests/corrections.spec.ts in correction-review must name its proving test titles or give the reason none exists, not both.';
    expect(validate(neither)).toContain(message);
    expect(validate(both)).toContain(message);
  });
  test('a reasoned reference cannot be the only evidence of a mapping', () => {
    const reasoned = mapping();
    const reference = firstReference(reasoned);
    delete reference.titles;
    reference.unmatched = 'The file proves no clause of this ledger row.';
    expect(
      validate(reasoned).some((problem) => problem.startsWith('No executable evidence in correction-review')),
    ).toBe(true);
    expectDefined(reasoned.mappings[0]).evidence.push({
      file: 'tests/other.spec.ts',
      kind: 'browser',
      description: 'The flow that proves it.',
      titles: ['C-09'],
    });
    expect(validate(reasoned)).toEqual([]);
  });
  test('an inspection names no test', () => {
    const inspected = mapping();
    expectDefined(inspected.mappings[0]).evidence.push({
      kind: 'inspection',
      file: 'docs/review.md',
      description: 'A reviewer looked at it.',
      titles: ['C-01'],
    });
    expect(validate(inspected)).toEqual([
      'Inspection evidence in correction-review names no test: docs/review.md',
    ]);
  });
});
