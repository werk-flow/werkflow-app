import { describe, expect, test } from 'bun:test';
import { findSharedSentenceProblems, findSharedSentences, readSentences } from './one-home';

const rule =
  'The migration that creates a table enables RLS, adds policies and grants explicitly to each role.';

describe('sentences', () => {
  test('drops links, emphasis, list markers and fenced code, and splits at sentence ends', () => {
    const markdown = [
      '- **Bold** start with a [link](x.md). Second `code` sentence!',
      '````',
      'Code is never a sentence of a doc.',
      '```',
      'A shorter fence does not close a longer one.',
      '````',
      '## Heading line',
    ].join('\n');
    expect(readSentences(markdown)).toEqual([
      'bold start with a link',
      'second code sentence',
      'heading line',
    ]);
  });
});

describe('shared sentences', () => {
  test('probe: a twelve-word rule copied into a second doc is found with both homes', () => {
    const shared = findSharedSentences([
      { path: 'docs/technical/security.md', markdown: `1. ${rule}` },
      { path: 'AGENTS.md', markdown: `- **Good.** ${rule} More.` },
      { path: 'docs/README.md', markdown: 'Something else entirely.' },
    ]);
    expect(shared).toEqual([
      { sentence: rule.slice(0, -1).toLowerCase(), paths: ['docs/technical/security.md', 'AGENTS.md'] },
    ]);
  });

  test('a short sentence, and one repeated inside one doc, are no copies', () => {
    expect(
      findSharedSentences([
        { path: 'a.md', markdown: 'Grant to anon. Grant to anon.' },
        { path: 'b.md', markdown: 'Grant to anon.' },
        { path: 'c.md', markdown: `${rule} ${rule}` },
      ]),
    ).toEqual([]);
  });

  test('an allowlisted sentence passes, and an entry that no longer matches is stale', () => {
    const shared = findSharedSentences([
      { path: 'a.md', markdown: rule },
      { path: 'b.md', markdown: rule },
    ]);
    const sentence = shared[0]?.sentence ?? '';
    expect(findSharedSentenceProblems(shared, [sentence])).toEqual([]);
    expect(findSharedSentenceProblems(shared, [])).toEqual([
      `"${sentence}" stands in a.md and b.md; keep it in its one home and link to it from the others`,
    ]);
    expect(findSharedSentenceProblems([], ['gone sentence'])).toEqual([
      'the allowlisted shared sentence "gone sentence" no longer appears twice; remove its entry',
    ]);
  });
});
