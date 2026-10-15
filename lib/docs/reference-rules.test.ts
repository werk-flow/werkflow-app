import { describe, expect, test } from 'bun:test';
import {
  findNumberedRuleReferences,
  findRepositoryPathReferences,
  findUnresolvedRulePointers,
  numberedItemsUnder,
  findRouteHandlerReferences,
  repositoryPathCandidates,
} from './reference-rules';

describe('route handler names', () => {
  test('reads the handler folder from a path, a URL and a method-prefixed URL', () => {
    const text = [
      'The board reads `app/api/calendar-board/route.ts`.',
      'Reports go to `POST /api/csp-report` and `/api/attention-counts?scope=all`.',
    ].join('\n');
    expect(findRouteHandlerReferences(text)).toEqual([
      { line: 1, name: 'calendar-board' },
      { line: 2, name: 'csp-report' },
      { line: 2, name: 'attention-counts' },
    ]);
  });

  test('a folder, a wildcard or a placeholder names no handler', () => {
    expect(findRouteHandlerReferences('`app/api/` `app/api/*` `/api/*` `app/api/<name>` api/x')).toEqual([]);
  });
});

describe('numbered rules', () => {
  test('reports a numbered testing or security rule', () => {
    expect(
      findNumberedRuleReferences(
        'Testing rules 8 to 13 apply.\nIt follows security rule 9 and testing rule 13.',
      ),
    ).toEqual([
      { line: 1, name: 'Testing rules 8' },
      { line: 2, name: 'security rule 9' },
      { line: 2, name: 'testing rule 13' },
    ]);
  });

  test('the numbered maintenance rules of the docs index and unnumbered rules pass', () => {
    expect(
      findNumberedRuleReferences('See maintenance rule 6, the migration rule, item 8, and the testing rule.'),
    ).toEqual([]);
  });
});

describe('rule pointers in code', () => {
  const freshness = {
    document: 'realtime-and-caching.md#client-freshness-contract',
    phrase: /freshness contract\s*$/i,
    numbers: numberedItemsUnder(
      '# T\n\n## Client freshness contract\n\n1. **A.** x\n2. **B.** y\n\n## Next\n\n3. z\n',
      'Client freshness contract',
    ),
  };
  const sources = [
    freshness,
    { document: 'security.md', phrase: /\bsecurity(?:\.md)?,?\s*$/i, numbers: new Set<number>() },
  ];

  test('reads the list of one section only', () => {
    expect([...freshness.numbers]).toEqual([1, 2]);
  });

  test('reports a number the named list lacks, a document without numbers and a bare pointer', () => {
    const text = [
      '// keeps the data (freshness contract rule 2).',
      '// pending state (client freshness contract rule 3).',
      "  message: 'see security.md, rule 2',",
      '-- (docs/technical/security.md,',
      '-- rule 9 and the residual list)',
      '/** Rules 1 and 2 apply. */',
    ].join('\n');
    expect(findUnresolvedRulePointers(text, sources).map(({ line, name }) => `${line} ${name}`)).toEqual([
      '2 rule 3 (realtime-and-caching.md#client-freshness-contract has no such numbered rule)',
      '3 rule 2 (security.md has no such numbered rule)',
      '5 rule 9 (security.md has no such numbered rule)',
      '6 Rules 1 and 2 (names no document that numbers it)',
    ]);
  });

  test('a bare pointer resolves to the numbered rules the file states itself', () => {
    const text = [
      '// The rules:',
      '//   1. One.',
      '//   2. Two.',
      '/** Rules 1 and 2 for one module. */',
    ].join('\n');
    expect(findUnresolvedRulePointers(text, sources)).toEqual([]);
    expect(findUnresolvedRulePointers(`${text}\n// Rule 3: absence.`, sources)).toEqual([
      { line: 5, name: 'Rule 3 (names no document that numbers it)' },
    ]);
  });
});

describe('repository paths in a skill', () => {
  test('keeps files, module specifiers and the folder of a glob, without a line suffix', () => {
    const text = [
      'Copy `tests/golden/support/seed.ts:40` and `components/ui/button`.',
      'Specs live in `tests/audit/**/*.spec.ts` and `tests/golden/p1-<id>.spec.ts`.',
      'Helpers sit in `lib/ui/`.',
    ].join('\n');
    expect(findRepositoryPathReferences(text)).toEqual([
      { line: 1, name: 'tests/golden/support/seed.ts' },
      { line: 1, name: 'components/ui/button' },
      { line: 2, name: 'tests/audit' },
      { line: 2, name: 'tests/golden' },
      { line: 3, name: 'lib/ui' },
    ]);
  });

  test('ignores other code spans and paths outside the repository roots', () => {
    expect(findRepositoryPathReferences('`bun run lint` `references/README.md` `node_modules/x`')).toEqual(
      [],
    );
  });

  test('a specifier resolves with or without its extension', () => {
    expect(repositoryPathCandidates('components/ui/button')).toContain('components/ui/button.tsx');
    expect(repositoryPathCandidates('lib/ui/decimal.ts')[0]).toBe('lib/ui/decimal.ts');
  });
});
