import { describe, expect, test } from 'bun:test';
import {
  findNumberedRuleReferences,
  findRepositoryPathReferences,
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
