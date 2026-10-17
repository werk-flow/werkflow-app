import { describe, expect, test } from 'bun:test';
import { lastCommits, reviewStampProblem, uncommittedPaths } from './review-stamps';

const committed = (date: string, movedStamp = false) => ({ date, uncommitted: false, movedStamp });

describe('review stamps', () => {
  test('a stamp on or after the last change passes', () => {
    expect(reviewStampProblem('2026-10-17', committed('2026-10-17'), '2026-10-17')).toBeNull();
    expect(reviewStampProblem('2026-10-17', committed('2026-10-10'), '2026-10-17')).toBeNull();
  });

  test('probe: a doc committed after its stamp, by a commit that left the stamp alone, fails', () => {
    expect(reviewStampProblem('2026-10-05', committed('2026-10-08'), '2026-10-17')).toBe(
      "its last commit is from 2026-10-08, after its status line's last reviewed 2026-10-05; review it and set the date",
    );
  });

  test('a commit that moved the stamp recorded its review, even when it landed after midnight', () => {
    expect(reviewStampProblem('2026-10-17', committed('2026-10-18', true), '2026-10-18')).toBeNull();
  });

  test('probe: a doc changed in the working tree needs today, and a future stamp fails', () => {
    const uncommitted = { date: '2026-10-17', uncommitted: true, movedStamp: false };
    expect(reviewStampProblem('2026-10-16', uncommitted, '2026-10-17')).toContain(
      'set the date to 2026-10-17',
    );
    expect(reviewStampProblem('2026-10-18', uncommitted, '2026-10-17')).toContain('a day after today');
  });
});

describe('Git output', () => {
  test('the newest commit that lists a path is its last change', () => {
    const log =
      '\u0000abc123 2026-10-17\n\nnotes/a.md\nnotes/b.md\n\u0000def456 2026-10-10\n\nnotes/a.md\nnotes/c.md\n';
    expect(lastCommits(log)).toEqual(
      new Map([
        ['notes/a.md', { hash: 'abc123', date: '2026-10-17' }],
        ['notes/b.md', { hash: 'abc123', date: '2026-10-17' }],
        ['notes/c.md', { hash: 'def456', date: '2026-10-10' }],
      ]),
    );
  });

  test('porcelain entries name changed and untracked paths, renames by their new path', () => {
    const porcelain = [' M notes/a.md', '?? notes/new.md', 'R  notes/moved.md', 'notes/old.md', ''].join(
      '\u0000',
    );
    expect(uncommittedPaths(porcelain)).toEqual(new Set(['notes/a.md', 'notes/new.md', 'notes/moved.md']));
  });
});
