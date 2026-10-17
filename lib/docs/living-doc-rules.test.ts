import { describe, expect, test } from 'bun:test';
import {
  countWords,
  findBacktickedDocPaths,
  findCommitHashLines,
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

describe('allowed dated lines and commit hashes', () => {
  test('a line the exemption pattern matches may carry a date', () => {
    const markdown = [
      '# Roadmap',
      '',
      'Status: living — last reviewed 2026-10-17',
      '| `P1-01` | `complete` | Accepted 2026-08-04 |',
      'Decided 2026-09-17.',
    ].join('\n');
    expect(findDatedLines(markdown, /^\| `P1-\d{2}` \| `complete` \|/)).toEqual([5]);
    // A global pattern keeps no state between lines.
    expect(findDatedLines(`${markdown}\n${markdown.split('\n')[3] ?? ''}`, /^\| `P1-\d{2}` \|/g)).toEqual([
      5,
    ]);
  });

  test('probe: a commit hash in backticks or after "commit" fails, a word or a number does not', () => {
    const markdown = [
      'Read at commit `3e6b450`.',
      'Fixed in commit 20c9ca8cc13ed.',
      'The `deadbeef` constant and `1234567` and the word decade.',
      'A link [here](../x.md#3e6b450abc) carries no hash in its prose.',
    ].join('\n');
    expect(findCommitHashLines(markdown)).toEqual([1, 2]);
  });
});

describe('backticked doc paths', () => {
  test('probe: a backticked doc outside link text, quotes and fences is found', () => {
    const markdown = [
      'See `technical/security.md` and [`testing.md`](technical/testing.md).',
      '> Quoted `technical/security.md`.',
      '```',
      '`technical/security.md`',
      '```',
      '~~~',
      '`technical/security.md` inside a tilde fence, which a backtick line does not close:',
      '```',
      '~~~',
      'Not a doc: `error-context.md`.',
    ].join('\n');
    expect(findBacktickedDocPaths(markdown, (name) => name !== 'error-context.md')).toEqual([
      { line: 1, reference: 'technical/security.md' },
    ]);
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
