import { describe, expect, test } from 'bun:test';
import { findIndexCoverageProblems } from './doc-index';

const index = [
  '| [security.md](technical/security.md) | Read when X. |',
  '| [old.md](plans/old.md) | Closed — history. |',
].join('\n');

describe('index coverage', () => {
  test('a linked doc and the index itself pass', () => {
    expect(findIndexCoverageProblems(index, ['README.md', 'technical/security.md'])).toEqual([]);
  });

  test('probe: an unlinked doc fails', () => {
    expect(findIndexCoverageProblems(index, ['technical/new.md'])).toEqual([
      'technical/new.md is not linked from docs/README.md; add it to the index or retire the file',
    ]);
  });
});
