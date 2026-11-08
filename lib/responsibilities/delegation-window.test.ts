import { describe, expect, test } from 'bun:test';

import { delegationRevocationDate, delegationWindowState } from './delegation-window';

const today = '2026-11-08';
const window = (validFrom: string, validUntil: string, revokedFrom: string | null = null) => ({
  validFrom,
  validUntil,
  revokedFrom,
});

describe('delegation window state', () => {
  test('a window that has not started is planned and is removed from its first day', () => {
    const planned = window('2026-11-09', '2026-11-13');
    expect(delegationWindowState(planned, today)).toBe('planned');
    expect(delegationRevocationDate(planned, today)).toBe('2026-11-09');
  });

  test('a running window, its first and last day included, ends today', () => {
    for (const running of [window('2026-11-08', '2026-11-13'), window('2026-11-02', '2026-11-08')]) {
      expect(delegationWindowState(running, today)).toBe('active');
      expect(delegationRevocationDate(running, today)).toBe(today);
    }
  });

  test('a window revoked from its first day was removed and is never revoked again', () => {
    const removed = window('2026-11-09', '2026-11-13', '2026-11-09');
    expect(delegationWindowState(removed, today)).toBe('removed');
    expect(delegationWindowState(removed, '2026-11-10')).toBe('removed');
    expect(delegationRevocationDate(removed, today)).toBeNull();
  });

  test('a window that ran out or was ended today is over and writes nothing', () => {
    for (const over of [window('2026-11-02', '2026-11-07'), window('2026-11-02', '2026-11-13', today)]) {
      expect(delegationWindowState(over, today)).toBe('ended');
      expect(delegationRevocationDate(over, today)).toBeNull();
    }
  });
});
