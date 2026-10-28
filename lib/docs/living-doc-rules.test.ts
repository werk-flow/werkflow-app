import { describe, expect, test } from 'bun:test';
import { countWords, findDocumentReferences } from './living-doc-rules';

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
