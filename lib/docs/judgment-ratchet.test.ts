import { describe, expect, test } from 'bun:test';
import { findJudgmentRatchetProblems, parseJudgmentRatchet, type JudgmentRatchet } from './judgment-ratchet';

const doc = 'docs/technical/security.md';

describe('judgment ratchet', () => {
  test('a count equal to its record passes', () => {
    expect(findJudgmentRatchetProblems(new Map([[doc, 8]]), { [doc]: { judgment: 8 } }, null)).toEqual([]);
  });

  test('probe: retagging an item [judgment] raises the count above the record', () => {
    expect(findJudgmentRatchetProblems(new Map([[doc, 9]]), { [doc]: { judgment: 8 } }, null)).toEqual([
      `${doc} has 9 [judgment] tags, more than its recorded 8; name the mechanism that enforces the new item instead`,
    ]);
  });

  test('a fallen count asks to lower the record', () => {
    expect(findJudgmentRatchetProblems(new Map([[doc, 7]]), { [doc]: { judgment: 8 } }, null)).toEqual([
      `${doc} has 7 [judgment] tags; lower its entry in lib/docs/judgment-ratchet.json from 8`,
    ]);
  });

  test('probe: a record raised against the committed one needs a new owner reason', () => {
    const committed: JudgmentRatchet = { [doc]: { judgment: 8, raisedBecause: 'old reason' } };
    const counted = new Map([[doc, 9]]);
    expect(findJudgmentRatchetProblems(counted, { [doc]: { judgment: 9 } }, committed)).toHaveLength(1);
    expect(
      findJudgmentRatchetProblems(
        counted,
        { [doc]: { judgment: 9, raisedBecause: 'old reason' } },
        committed,
      ),
    ).toHaveLength(1);
    expect(
      findJudgmentRatchetProblems(
        counted,
        { [doc]: { judgment: 9, raisedBecause: 'owner, 2026-10-20: X' } },
        committed,
      ),
    ).toEqual([]);
  });

  test('a doc missing on either side fails', () => {
    expect(
      findJudgmentRatchetProblems(new Map([[doc, 1]]), { 'guides/gone.md': { judgment: 1 } }, null),
    ).toEqual([
      `${doc} has 1 [judgment] tags but no entry in lib/docs/judgment-ratchet.json`,
      'lib/docs/judgment-ratchet.json names guides/gone.md, which is no owner doc',
    ]);
  });

  test('parses the recorded shape and refuses anything else', () => {
    expect(parseJudgmentRatchet({ [doc]: { judgment: 8, raisedBecause: 'x' } })).toEqual({
      [doc]: { judgment: 8, raisedBecause: 'x' },
    });
    expect(() => parseJudgmentRatchet({ [doc]: { judgment: '8' } })).toThrow();
    expect(() => parseJudgmentRatchet([])).toThrow();
  });
});
