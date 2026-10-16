import { describe, expect, test } from 'bun:test';

import { deletionPassProblems, deletionPassRecord, parsePublishedCommits } from './deletion-pass';

const SHA = 'a'.repeat(40);

describe('deletion pass in commit bodies', () => {
  test('a body with a filled line passes', () => {
    const message =
      'Split the time actions\n\nBody text.\n\nDeletion pass: removed two unused exports and a wrapper.\n\nCo-Authored-By: X <x@example.com>\n';
    expect(deletionPassRecord(message)).toBe('removed two unused exports and a wrapper.');
    expect(deletionPassProblems([{ sha: SHA, message }])).toEqual([]);
  });

  test('a body without the line fails with the commit named', () => {
    expect(deletionPassProblems([{ sha: SHA, message: 'Fix a label\n\nNo record here.\n' }])).toEqual([
      'Commit aaaaaaa ("Fix a label") records no deletion pass: add a "Deletion pass: <what it removed>" line to its body (docs/technical/code-quality.md).',
    ]);
  });

  test('an empty value, a line inside other text, a lower-case label and a subject-only record fail', () => {
    for (const message of [
      'Subject\n\nDeletion pass:   \n',
      'Subject\n\nSee the Deletion pass: below.\n',
      'Subject\n\ndeletion pass: removed nothing\n',
      'Deletion pass: none needed.\n\nThe record sits in the subject, not the body.\n',
    ]) {
      expect(deletionPassRecord(message), message).toBeUndefined();
      expect(deletionPassProblems([{ sha: SHA, message }]), message).toHaveLength(1);
    }
  });

  test('git log output splits into commits with their full messages', () => {
    const log = `${SHA}\0First\n\nDeletion pass: none needed.\n\x1e\n${'b'.repeat(40)}\0Second\n\x1e\n`;
    expect(parsePublishedCommits(log)).toEqual([
      { sha: SHA, message: 'First\n\nDeletion pass: none needed.\n' },
      { sha: 'b'.repeat(40), message: 'Second\n' },
    ]);
  });
});
