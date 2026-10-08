import { describe, expect, test } from 'bun:test';
import {
  countWords,
  findDatedLines,
  findDocumentReferences,
  findMismatchedGermanQuotes,
} from './living-doc-rules';

describe('dates in a living doc', () => {
  test('allows the status line and a dated anchor inside a link target', () => {
    const markdown = [
      '# Testing',
      '',
      'Status: living — last reviewed 2026-10-01',
      '',
      '[The amendment](../decisions/0007.md#amendment-2026-10-01-browser-tests) owns the rules.',
    ].join('\n');
    expect(findDatedLines(markdown)).toEqual([]);
  });

  test('reports a date in prose, in a heading and in link text', () => {
    const markdown = [
      '# Security',
      '',
      'Status: living — last reviewed 2026-10-01',
      '',
      '## Grants, inspected 2026-09-28',
      'Applied to DEV on 2026-09-28.',
      'See the [2026-10-01 amendment](decision.md).',
      'A migration named 20260928095752_explicit.sql is not a date.',
    ].join('\r\n');
    expect(findDatedLines(markdown)).toEqual([5, 6, 7]);
  });
});

describe('word count', () => {
  test('counts whitespace-separated words like wc -w', () => {
    expect(countWords('one two\n\nthree\tfour  ')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});

describe('references from guidance files', () => {
  test('collects relative links without their fragment and backticked docs paths', () => {
    const markdown = 'Read [the index](docs/README.md#index) and `docs/technical/testing.md`.';
    expect(findDocumentReferences(markdown)).toEqual([
      { kind: 'link', target: 'docs/README.md' },
      { kind: 'path', target: 'docs/technical/testing.md' },
    ]);
  });

  test('ignores external links, bare anchors, code paths and skill-relative names', () => {
    const markdown = '[site](https://example.com) [here](#top) `lib/storage/r2.ts` `references/README.md`';
    expect(findDocumentReferences(markdown)).toEqual([]);
  });
});

describe('German quotation marks', () => {
  test('a quotation that opens with „ closes with “', () => {
    expect(findMismatchedGermanQuotes('The button says „Speichern“ and „Hinweis schließen“.')).toEqual([]);
  });

  test('a straight or English closing quote after „ fails on its line', () => {
    const markdown = ['Fine „Kalender“.', 'Name it „Hinweis schließen".', 'Or „Rückgängig” here.'].join('\n');
    expect(findMismatchedGermanQuotes(markdown)).toEqual([2, 3]);
  });
});
