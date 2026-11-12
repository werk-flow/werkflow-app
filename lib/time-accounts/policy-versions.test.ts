import { describe, expect, test } from 'bun:test';

import { describePolicyVersions, versionInForce } from './policy-versions';

// The walkthrough case: version 1 from 29.10., then version 2 backdated to 01.08.
const backdated = [
  { version: 1, effective_from: '2026-10-29' },
  { version: 2, effective_from: '2026-08-01' },
];

describe('versionInForce: the version a day is calculated with', () => {
  test('the latest start on or before the day wins, not the highest version', () => {
    expect(versionInForce(backdated, '2026-11-11')?.version).toBe(1);
    expect(versionInForce(backdated, '2026-10-28')?.version).toBe(2);
    expect(versionInForce(backdated, '2026-08-01')?.version).toBe(2);
  });

  test('of two versions with the same start the higher version wins', () => {
    const sameStart = [
      { version: 1, effective_from: '2026-09-01' },
      { version: 2, effective_from: '2026-09-01' },
    ];
    expect(versionInForce(sameStart, '2026-09-15')?.version).toBe(2);
  });

  test('a day before the first start has no version', () => {
    expect(versionInForce(backdated, '2026-07-31')).toBeUndefined();
  });
});

describe('describePolicyVersions: the rules card lists every version with its span', () => {
  test('a backdated version keeps the earlier one visible and marks the one in force today', () => {
    expect(describePolicyVersions(backdated, '2026-11-11')).toEqual([
      { version: 1, effectiveFrom: '2026-10-29', validUntil: null, status: 'in_force', replacedBy: null },
      { version: 2, effectiveFrom: '2026-08-01', validUntil: '2026-10-28', status: 'past', replacedBy: null },
    ]);
  });

  test('a future start is planned and ends the span of the version in force', () => {
    const lines = describePolicyVersions(
      [
        { version: 1, effective_from: '2026-01-01' },
        { version: 2, effective_from: '2027-01-01' },
      ],
      '2026-11-11',
    );
    expect(lines.map((line) => [line.version, line.status, line.validUntil])).toEqual([
      [2, 'planned', null],
      [1, 'in_force', '2026-12-31'],
    ]);
  });

  test('a version replaced on its own start day never applies and names its replacement', () => {
    const lines = describePolicyVersions(
      [
        { version: 1, effective_from: '2026-09-01' },
        { version: 2, effective_from: '2026-09-01' },
      ],
      '2026-11-11',
    );
    expect(lines.map((line) => [line.version, line.status, line.replacedBy])).toEqual([
      [2, 'in_force', null],
      [1, 'replaced', 2],
    ]);
  });

  test('exactly one version is in force once the first start has passed', () => {
    const lines = describePolicyVersions(backdated, '2026-10-29');
    expect(lines.filter((line) => line.status === 'in_force').map((line) => line.version)).toEqual([1]);
  });
});
