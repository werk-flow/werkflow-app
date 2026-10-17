import { describe, expect, test } from 'bun:test';
import { findIncidentTierProblems } from './incident-tiers';

const accept = (): null => null;

describe('incident tiers', () => {
  test('an entry naming its tier passes, and an entry before the ladder is history', () => {
    const log = [
      '## 2026-10-16 audit:layout:work',
      '- Prevention: Tier 2: the ui:contracts case.',
      '',
      '## 2026-08-20 old entry',
      '- Prevention: retried.',
    ].join('\n');
    expect(findIncidentTierProblems(log, accept)).toEqual([]);
  });

  test('probe: an entry without a tier and a refused tier claim fail', () => {
    const log = [
      '## 2026-10-16 no tier',
      '- Prevention: be careful.',
      '',
      '## 2026-10-17 bad claim',
      '- Prevention: Tier 1: nothing.',
    ].join('\n');
    const problems = findIncidentTierProblems(log, (line) =>
      line.includes('nothing') ? 'names no mechanism' : null,
    );
    expect(problems).toEqual([
      expect.stringContaining('"2026-10-16 no tier" names no enforcement tier'),
      '"2026-10-17 bad claim": names no mechanism',
    ]);
  });
});
