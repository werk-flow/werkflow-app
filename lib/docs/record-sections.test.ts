import { describe, expect, test } from 'bun:test';
import {
  deletionPassProblems,
  hasDurableHomes,
  PULL_REQUESTS_SINCE,
  REVIEW_RECORDS_SINCE,
} from './record-sections';

const RECORD_PATH = `.agent-logs/review/${'a'.repeat(40)}-20261024T101500000Z.json`;
const section = (lines: string[]): string =>
  ['## Deletion pass and review', '', ...lines, '', '## Durable homes'].join('\n');
const complete = [
  'Before: 12 files changed, 300 insertions(+).',
  'After: 10 files changed, 250 insertions(+).',
  'Removed: the unused `formatLegacy` export and its test.',
  `Review: \`bun run review --dir lib\` (${RECORD_PATH}), two findings repaired.`,
];
const problems = (lines: string[], closedOn = REVIEW_RECORDS_SINCE): string[] =>
  deletionPassProblems({ markdown: section(lines), closedOn });

describe('deletion pass and review', () => {
  test('a section with labelled shortstats, the removals, the review command and its record passes', () => {
    expect(problems(complete)).toEqual([]);
    // "Nothing to remove" with its reason replaces the list.
    const nothing = complete.with(2, 'Nothing to remove because the change only renamed two labels.');
    expect(problems(nothing)).toEqual([]);
  });

  test('probe: a missing section, shortstat, removal and review command each fail', () => {
    expect(deletionPassProblems({ markdown: '## Other\n', closedOn: '2026-09-20' })).toHaveLength(1);
    expect(problems(['1 file changed.'], '2026-09-20')).toEqual([
      'must record the git diff --shortstat line before and after the deletion pass',
      'must name what the deletion pass removed ("Removed: …") or state "Nothing to remove because …"',
      'must record the bun run review command it ran and the disposition of every finding',
    ]);
  });

  test('probe: two unlabelled shortstats and a bare "nothing to remove" do not count', () => {
    const unlabelled = complete.with(0, '12 files changed.').with(1, '10 files changed.');
    expect(problems(unlabelled)).toContain(
      'must record the git diff --shortstat line before and after the deletion pass',
    );
    expect(problems(complete.with(2, 'Nothing to remove.'))).toContain(
      'must name what the deletion pass removed ("Removed: …") or state "Nothing to remove because …"',
    );
  });

  test('probe: from its first day, a record cites the review record it wrote', () => {
    const uncited = complete.with(3, 'Review: `bun run review --dir lib`, two findings repaired.');
    expect(problems(uncited)).toEqual([
      'must cite the review record each review wrote (.agent-logs/review/<sha>-<time>.json)',
    ]);
    // A record closed before the rule is history.
    expect(problems(uncited, '2026-10-23')).toEqual([]);
  });

  test('probe: from decision 0009, a record links the pull request that carried its review', () => {
    const linked = complete.with(
      3,
      'Review: CodeRabbit on https://github.com/werk-flow/werkflow-app/pull/12, two findings repaired.',
    );
    expect(problems(linked, PULL_REQUESTS_SINCE)).toEqual([]);
    expect(problems(complete, PULL_REQUESTS_SINCE)).toEqual([
      'must link the pull request whose review and finding dispositions it records',
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
