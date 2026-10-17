import { describe, expect, test } from 'bun:test';
import { decisionGrowthProblem } from './decision-records';

const accepted = [
  '# 0009 — A decision',
  '',
  '- **Status:** accepted (2026-10-01)',
  '',
  '## Decision',
  '',
  'We do X.',
  '',
].join('\n');

describe('decision record growth', () => {
  test('an unchanged record and an appended dated amendment pass, also across line endings', () => {
    expect(decisionGrowthProblem(accepted, accepted.replace(/\n/g, '\r\n'))).toBeNull();
    expect(
      decisionGrowthProblem(accepted, `${accepted}\n## Amendment 2026-10-17: Y as well\n\nWe also do Y.\n`),
    ).toBeNull();
  });

  test('probe: a rewritten accepted line fails with its line number', () => {
    expect(decisionGrowthProblem(accepted, accepted.replace('We do X.', 'We do Z.'))).toBe(
      'line 7 of the accepted text changed; restore it and record the change as a dated amendment section at the end',
    );
  });

  test('probe: text added to the last accepted line or a truncated record fails with its line', () => {
    expect(decisionGrowthProblem(accepted, accepted.replace('We do X.', 'We do X. And Z.'))).toContain(
      'line 7',
    );
    expect(decisionGrowthProblem(accepted, accepted.replace('\nWe do X.\n', '\n'))).toContain('line 6');
  });

  test('probe: appended text without a dated amendment heading fails', () => {
    const problem = 'the added text must be sections headed "## Amendment YYYY-MM-DD: <title>"';
    expect(decisionGrowthProblem(accepted, `${accepted}\nA quiet extra sentence.\n`)).toBe(problem);
    expect(decisionGrowthProblem(accepted, `${accepted}\n## Notes\n\nText.\n`)).toBe(problem);
    expect(
      decisionGrowthProblem(accepted, `${accepted}\n## Amendment 2026-10-17: Y\n\nText.\n\n## Notes\n`),
    ).toBe(problem);
  });
});
