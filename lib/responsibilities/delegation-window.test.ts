import { describe, expect, test } from 'bun:test';

import { delegationRevocationDate, delegationWindowState, revokedOnOf } from './delegation-window';

const today = '2026-11-08';
const window = (
  validFrom: string,
  validUntil: string,
  revocation: { from: string; on: string } | null = null,
) => ({
  validFrom,
  validUntil,
  revokedFrom: revocation?.from ?? null,
  revokedOn: revocation?.on ?? null,
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

  test('a window revoked before its first day was removed and is never revoked again', () => {
    const removed = window('2026-11-09', '2026-11-13', { from: '2026-11-09', on: today });
    expect(delegationWindowState(removed, today)).toBe('removed');
    expect(delegationWindowState(removed, '2026-11-10')).toBe('removed');
    expect(delegationRevocationDate(removed, today)).toBeNull();
  });

  test('a window ended on its first day ran and stays ended, never removed', () => {
    const endedOnFirstDay = window(today, '2026-11-13', { from: today, on: today });
    expect(delegationWindowState(endedOnFirstDay, today)).toBe('ended');
    expect(delegationWindowState(endedOnFirstDay, '2026-11-20')).toBe('ended');
    const oneDayEndedThatDay = window(today, today, { from: today, on: today });
    expect(delegationWindowState(oneDayEndedThatDay, '2026-11-09')).toBe('ended');
  });

  test('a window that ran out or was ended today is over and writes nothing', () => {
    for (const over of [
      window('2026-11-02', '2026-11-07'),
      window('2026-11-02', '2026-11-13', { from: today, on: today }),
    ]) {
      expect(delegationWindowState(over, today)).toBe('ended');
      expect(delegationRevocationDate(over, today)).toBeNull();
    }
  });

  test('the revocation day is the Berlin date of the row’s update, and none while not revoked', () => {
    // 23:30 UTC on 7 November is 00:30 on 8 November in Berlin.
    expect(revokedOnOf({ revoked_from: today, updated_at: '2026-11-07T23:30:00.000Z' })).toBe(today);
    expect(revokedOnOf({ revoked_from: null, updated_at: '2026-11-07T23:30:00.000Z' })).toBeNull();
  });
});
