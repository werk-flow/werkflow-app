import { describe, expect, test } from 'bun:test';
import { findIndexCoverageProblems, findIndexStatusProblems } from './doc-index';

const index = [
  '| [security.md](technical/security.md) | Read when X. |',
  '| [old.md](plans/old.md) | Closed — history. |',
  '| phase-1/slices/ | One document per slice. |',
].join('\n');

describe('index coverage', () => {
  test('a linked doc, a slice record under the folder row and the index itself pass', () => {
    expect(
      findIndexCoverageProblems(index, [
        'README.md',
        'technical/security.md',
        'plans/phase-1/slices/p1-01-x.md',
      ]),
    ).toEqual([]);
  });

  test('probe: an unlinked doc fails, and a slice record fails without the folder row', () => {
    expect(findIndexCoverageProblems(index, ['technical/new.md'])).toEqual([
      'technical/new.md is not linked from docs/README.md; add it to the index or retire the file',
    ]);
    expect(findIndexCoverageProblems('no rows', ['plans/phase-1/slices/p1-01-x.md'])).toEqual([
      'plans/phase-1/slices/p1-01-x.md relies on the phase-1/slices folder row, which is missing from docs/README.md',
    ]);
  });
});

describe('index status prefixes', () => {
  test('probe: a prefix that disagrees with the doc, and an unknown prefix, fail', () => {
    const rows = ['| [old.md](plans/old.md) | Living — x |', '| [a.md](a.md) | Accepted — x |'].join('\n');
    expect(
      findIndexStatusProblems(rows, new Map([['plans/old.md', { kind: 'closed', date: '2026-09-20' }]])),
    ).toEqual([
      'the row for plans/old.md says "Living" but the doc\'s status line says "closed"',
      'the row for a.md uses "Accepted —"; index rows say "Closed —" or "Living —" only',
    ]);
    expect(
      findIndexStatusProblems(index, new Map([['plans/old.md', { kind: 'closed', date: '2026-09-20' }]])),
    ).toEqual([]);
  });
});
