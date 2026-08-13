import { describe, expect, test } from 'bun:test';

import { calculateIntervalOverlapMinutes, evaluateCapacity, fingerprintSnapshot } from './capacity';

describe('planning capacity resolution', () => {
  test('separates effective, provisional, overlap, and capacity warnings', () => {
    const result = evaluateCapacity(
      [{ employeeRecordId: 'employee', localDate: '2026-08-12', minutes: 240 }],
      [
        {
          employeeRecordId: 'employee',
          localDate: '2026-08-12',
          targetMinutes: 480,
          targetSource: 'schedule',
          approvedAbsenceMinutes: 120,
          pendingAbsenceMinutes: 60,
          existingPlannedMinutes: 180,
          overlapMinutes: 30,
        },
      ]
    );
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual([
      'approved_absence',
      'pending_absence',
      'overlap',
      'over_capacity',
    ]);
    expect(result.employeeDays[0].remainingMinutes).toBe(180);
  });

  test('keeps missing configuration distinct from an explicit zero target', () => {
    const missing = evaluateCapacity(
      [{ employeeRecordId: 'employee', localDate: '2026-08-12', minutes: 60 }],
      []
    );
    const closed = evaluateCapacity(
      [{ employeeRecordId: 'employee', localDate: '2026-08-12', minutes: 60 }],
      [
        {
          employeeRecordId: 'employee',
          localDate: '2026-08-12',
          targetMinutes: 0,
          targetSource: 'closure',
          approvedAbsenceMinutes: 0,
          pendingAbsenceMinutes: 0,
          existingPlannedMinutes: 0,
          overlapMinutes: 0,
        },
      ]
    );
    expect(missing.conflicts[0].kind).toBe('no_schedule');
    expect(closed.conflicts.map((conflict) => conflict.kind)).toEqual([
      'holiday_or_closure',
      'over_capacity',
    ]);
  });

  test('combines several proposed visits before comparing daily capacity', () => {
    const result = evaluateCapacity(
      [
        { employeeRecordId: 'employee', localDate: '2026-08-12', minutes: 300 },
        { employeeRecordId: 'employee', localDate: '2026-08-12', minutes: 240 },
      ],
      [
        {
          employeeRecordId: 'employee',
          localDate: '2026-08-12',
          targetMinutes: 480,
          targetSource: 'schedule',
          approvedAbsenceMinutes: 0,
          pendingAbsenceMinutes: 0,
          existingPlannedMinutes: 0,
          overlapMinutes: 0,
        },
      ]
    );

    expect(result.employeeDays).toHaveLength(1);
    expect(result.employeeDays[0].proposedMinutes).toBe(540);
    expect(result.conflicts.map((conflict) => conflict.kind)).toEqual([
      'over_capacity',
    ]);
  });

  test('calculates actual interval overlap only', () => {
    expect(
      calculateIntervalOverlapMinutes(
        new Date('2026-08-12T08:00:00Z'),
        new Date('2026-08-12T10:00:00Z'),
        new Date('2026-08-12T09:30:00Z'),
        new Date('2026-08-12T11:00:00Z')
      )
    ).toBe(30);
  });

  test('fingerprints snapshots independently of object key order', async () => {
    expect(await fingerprintSnapshot({ b: 2, a: { d: 4, c: 3 } })).toBe(
      await fingerprintSnapshot({ a: { c: 3, d: 4 }, b: 2 })
    );
  });

  test('distinguishes an undefined property from an absent property', async () => {
    expect(await fingerprintSnapshot({ value: undefined })).not.toBe(
      await fingerprintSnapshot({})
    );
  });
});
