import { describe, expect, test } from 'bun:test';

import { resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { onCallWeek, isOnCallAt, shiftPhase } from './rules';

/** The instant of a Berlin wall time; the first one of an ambiguous autumn hour. */
function berlin(localDateTime: string): Date {
  const resolved = resolveBerlinWallTime(localDateTime);
  if (!resolved) throw new Error(`no Berlin time ${localDateTime}`);
  return resolved.instant;
}

function shift(start: string, end: string, cancelledAt: string | null = null) {
  return { startsAt: berlin(start).toISOString(), endsAt: berlin(end).toISOString(), cancelledAt };
}

describe('who is on call now', () => {
  // A shift is on call from its start until, not including, its end.
  test.each([
    ['across midnight, before the start', shift('2026-11-16T22:00', '2026-11-17T06:00'), '2026-11-16T21:59', false],
    ['across midnight, at the start', shift('2026-11-16T22:00', '2026-11-17T06:00'), '2026-11-16T22:00', true],
    ['across midnight, at midnight', shift('2026-11-16T22:00', '2026-11-17T06:00'), '2026-11-17T00:00', true],
    ['across midnight, a minute before the end', shift('2026-11-16T22:00', '2026-11-17T06:00'), '2026-11-17T05:59', true],
    ['across midnight, at the end', shift('2026-11-16T22:00', '2026-11-17T06:00'), '2026-11-17T06:00', false],
    ['a weekend, on Saturday noon', shift('2026-11-20T16:00', '2026-11-23T07:00'), '2026-11-21T12:00', true],
    ['a weekend, on Monday at the handover', shift('2026-11-20T16:00', '2026-11-23T07:00'), '2026-11-23T07:00', false],
    ['the autumn DST night, in the repeated hour', shift('2026-10-23T16:00', '2026-10-26T07:00'), '2026-10-25T02:30', true],
    ['the autumn DST night, on Monday morning', shift('2026-10-23T16:00', '2026-10-26T07:00'), '2026-10-26T06:59', true],
    ['the spring DST night, after the gap', shift('2026-03-28T22:00', '2026-03-29T06:00'), '2026-03-29T03:00', true],
    ['the spring DST night, at the end', shift('2026-03-28T22:00', '2026-03-29T06:00'), '2026-03-29T06:00', false],
  ])('%s', (_case, onCall, at, expected) => {
    expect(isOnCallAt(onCall, berlin(at))).toBe(expected);
  });

  test('the second, standard-time pass of the repeated autumn hour is still on call', () => {
    const night = shift('2026-10-24T22:00', '2026-10-25T06:00');
    expect(isOnCallAt(night, new Date('2026-10-25T01:30:00.000Z'))).toBe(true);
  });

  test('a cancelled shift is never on call', () => {
    const cancelled = shift('2026-11-16T22:00', '2026-11-17T06:00', '2026-11-15T10:00:00.000Z');
    expect(isOnCallAt(cancelled, berlin('2026-11-17T00:00'))).toBe(false);
    expect(shiftPhase(cancelled, berlin('2026-11-17T00:00'))).toBe('cancelled');
  });

  test('a shift is planned before, running during and over after its time', () => {
    const night = shift('2026-11-16T22:00', '2026-11-17T06:00');
    expect(shiftPhase(night, berlin('2026-11-16T12:00'))).toBe('planned');
    expect(shiftPhase(night, berlin('2026-11-16T23:00'))).toBe('running');
    expect(shiftPhase(night, berlin('2026-11-17T06:00'))).toBe('over');
  });
});

describe('the Berlin week a list shows', () => {
  test.each([
    ['a Monday', '2026-11-16', '2026-11-16', '2026-11-15T23:00:00.000Z', '2026-11-22T23:00:00.000Z'],
    ['a Sunday', '2026-11-22', '2026-11-16', '2026-11-15T23:00:00.000Z', '2026-11-22T23:00:00.000Z'],
    ['a week across the month end', '2026-12-02', '2026-11-30', '2026-11-29T23:00:00.000Z', '2026-12-06T23:00:00.000Z'],
    ['a leap day', '2028-02-29', '2028-02-28', '2028-02-27T23:00:00.000Z', '2028-03-05T23:00:00.000Z'],
    ['the autumn DST week, one hour longer', '2026-10-21', '2026-10-19', '2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
    ['a week in the past', '2025-01-01', '2024-12-30', '2024-12-29T23:00:00.000Z', '2025-01-05T23:00:00.000Z'],
  ])('%s', (_case, day, monday, from, until) => {
    const week = onCallWeek(day);
    expect(week.monday).toBe(monday);
    expect(week.from.toISOString()).toBe(from);
    expect(week.until.toISOString()).toBe(until);
  });
});
