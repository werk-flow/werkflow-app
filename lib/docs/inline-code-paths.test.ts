import { expect, test } from 'bun:test';
import { findInlineCodePaths } from './inline-code-paths';

test('every whole inline code span shaped like a repository path keeps its line', () => {
  expect(
    findInlineCodePaths(
      [
        '`lib/org/action-context.ts` and `components/ui/`',
        '`.claude/hooks/refuse-unresolvable-delete.ts`',
        '`werk-flow/werkflow-planning#<n>` and `rm -f logs/*`',
        '`useServerAction`, `bun run docs:check` and `Handwerker/in`',
        '``lib/missing-mechanism.ts``',
      ].join('\n'),
    ),
  ).toEqual([
    { line: 1, path: 'lib/org/action-context.ts' },
    { line: 1, path: 'components/ui/' },
    { line: 2, path: '.claude/hooks/refuse-unresolvable-delete.ts' },
    { line: 5, path: 'lib/missing-mechanism.ts' },
  ]);
});

test('fenced examples never supply named mechanisms or change subsequent line numbers', () => {
  expect(
    findInlineCodePaths(
      [
        '````md',
        '`lib/fake.ts`',
        '```',
        '`lib/still-fake.ts`',
        '````',
        '~~~md',
        '`lib/also-fake.ts`',
        '~~~',
        '`lib/real.ts`',
      ].join('\n'),
    ),
  ).toEqual([{ line: 9, path: 'lib/real.ts' }]);
});

test('a triple-backtick span on one line is inline code, not a fence, and spans keep CommonMark padding', () => {
  expect(
    findInlineCodePaths(
      ['```lib/triple.ts```', '`lib/next-line.ts`', '` lib/padded.ts `', '`` `lib/example-only.ts` ``'].join(
        '\n',
      ),
    ),
  ).toEqual([
    { line: 1, path: 'lib/triple.ts' },
    { line: 2, path: 'lib/next-line.ts' },
    { line: 3, path: 'lib/padded.ts' },
  ]);
});

test('a fence indented under a list item hides its example paths', () => {
  expect(
    findInlineCodePaths(
      ['1. Run it:', '', '    ```bash', '    `lib/example.ts`', '    ```', '`lib/after.ts`'].join('\n'),
    ),
  ).toEqual([{ line: 6, path: 'lib/after.ts' }]);
});
