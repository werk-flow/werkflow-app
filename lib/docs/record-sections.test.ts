import { describe, expect, test } from 'bun:test';
import { deletionPassProblems, hasDurableHomes } from './record-sections';

describe('deletion pass and review', () => {
  test('a section with both shortstat lines and the review command passes', () => {
    const record = [
      '## Deletion pass and review',
      '',
      'Before: 12 files changed, 300 insertions(+). After: 10 files changed, 250 insertions(+).',
      'Review: `bun run review --dir lib`, two findings repaired.',
      '',
      '## Durable homes',
    ].join('\n');
    expect(deletionPassProblems(record)).toEqual([]);
  });

  test('probe: a missing section, a missing shortstat and a missing review each fail', () => {
    expect(deletionPassProblems('## Other\n')).toHaveLength(1);
    expect(deletionPassProblems('## Deletion pass and review\n\n1 file changed.\n')).toEqual([
      'must record the git diff --shortstat line before and after the deletion pass',
      'must record the bun run review command it ran and the disposition of every finding',
    ]);
  });
});

describe('durable homes', () => {
  test('a non-empty section names homes; an empty or missing one does not', () => {
    expect(hasDurableHomes('## Durable homes\n\n- [spec](x.md)\n')).toBe(true);
    expect(hasDurableHomes('## Durable homes\n\n## Next\n')).toBe(false);
    expect(hasDurableHomes('# Record\n')).toBe(false);
  });
});
