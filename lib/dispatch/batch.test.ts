import { describe, expect, test } from 'bun:test';

import { computeBatchShiftItems, type BatchSourceOccurrence } from './batch';

function timedSource(
  overrides: Partial<BatchSourceOccurrence>
): BatchSourceOccurrence {
  return {
    occurrenceId: 'occurrence-1',
    version: 3,
    timeKind: 'timed',
    // 2026-09-07 09:00 Europe/Berlin (CEST, UTC+2)
    startAt: '2026-09-07T07:00:00.000Z',
    endAt: '2026-09-07T09:00:00.000Z',
    startDate: null,
    endDateExclusive: null,
    ...overrides,
  };
}

describe('batch reschedule math', () => {
  test('timed shift keeps the Berlin wall time and the duration', () => {
    const result = computeBatchShiftItems([timedSource({})], {
      dayShift: 2,
      newTime: null,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.items[0].startAt).toBe('2026-09-09T07:00:00.000Z');
    expect(result.items[0].endAt).toBe('2026-09-09T09:00:00.000Z');
    expect(result.items[0].expectedVersion).toBe(3);
  });

  test('a uniform new time replaces the wall time for every item', () => {
    const result = computeBatchShiftItems(
      [
        timedSource({}),
        timedSource({
          occurrenceId: 'occurrence-2',
          startAt: '2026-09-08T12:00:00.000Z',
          endAt: '2026-09-08T13:00:00.000Z',
        }),
      ],
      { dayShift: 0, newTime: '06:30' }
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.items[0].startAt).toBe('2026-09-07T04:30:00.000Z');
    expect(result.items[1].startAt).toBe('2026-09-08T04:30:00.000Z');
    // Durations preserved: 2h and 1h.
    expect(result.items[0].endAt).toBe('2026-09-07T06:30:00.000Z');
    expect(result.items[1].endAt).toBe('2026-09-08T05:30:00.000Z');
  });

  test('shifting across the autumn DST change keeps 09:00 wall time', () => {
    // 2026-10-23 09:00 CEST (UTC+2) shifted +3 days lands after the
    // 2026-10-25 change: 09:00 CET is UTC+1.
    const result = computeBatchShiftItems(
      [
        timedSource({
          startAt: '2026-10-23T07:00:00.000Z',
          endAt: '2026-10-23T08:00:00.000Z',
        }),
      ],
      { dayShift: 3, newTime: null }
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.items[0].startAt).toBe('2026-10-26T08:00:00.000Z');
    // The absolute one-hour duration survives the DST transition.
    expect(result.items[0].endAt).toBe('2026-10-26T09:00:00.000Z');
  });

  test('a shift into the spring-forward gap resolves to the shifted wall time', () => {
    // 2026-03-28 02:30 CET (UTC+1) shifted +1 day lands in the skipped hour on
    // 2026-03-29; resolveBerlinWallTime shifts it forward to 03:30 CEST.
    const result = computeBatchShiftItems(
      [
        timedSource({
          startAt: '2026-03-28T01:30:00.000Z',
          endAt: '2026-03-28T02:30:00.000Z',
        }),
      ],
      { dayShift: 1, newTime: null }
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.items[0].startAt).toBe('2026-03-29T01:30:00.000Z');
    expect(result.items[0].endAt).toBe('2026-03-29T02:30:00.000Z');
    expect(result.items[0].dstResolution).toBe('shifted_forward');
  });

  test('a non-positive timed source duration is rejected with its occurrence id', () => {
    expect(
      computeBatchShiftItems(
        [
          timedSource({
            occurrenceId: 'inverted',
            startAt: '2026-09-07T09:00:00.000Z',
            endAt: '2026-09-07T09:00:00.000Z',
          }),
        ],
        { dayShift: 1, newTime: null }
      )
    ).toEqual({
      success: false,
      error: 'batch_item_invalid',
      occurrenceId: 'inverted',
    });
  });

  test('all-day items need a real day shift — a time-only move rejects them', () => {
    expect(
      computeBatchShiftItems(
        [
          {
            occurrenceId: 'all-day',
            version: 1,
            timeKind: 'all_day',
            startAt: null,
            endAt: null,
            startDate: '2026-09-07',
            endDateExclusive: '2026-09-08',
          },
        ],
        { dayShift: 0, newTime: '08:00' }
      )
    ).toEqual({
      success: false,
      error: 'batch_item_all_day_needs_day_shift',
      occurrenceId: 'all-day',
    });
  });

  test('all-day items shift both boundary dates and ignore the new time', () => {
    const result = computeBatchShiftItems(
      [
        {
          occurrenceId: 'occurrence-3',
          version: 1,
          timeKind: 'all_day',
          startAt: null,
          endAt: null,
          startDate: '2026-09-07',
          endDateExclusive: '2026-09-10',
        },
      ],
      { dayShift: 7, newTime: '08:00' }
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.items[0].startDate).toBe('2026-09-14');
    expect(result.items[0].endDateExclusive).toBe('2026-09-17');
    expect(result.items[0].startAt).toBeNull();
  });

  test('a no-op shift and invalid inputs are rejected deterministically', () => {
    expect(
      computeBatchShiftItems([timedSource({})], { dayShift: 0, newTime: null })
    ).toEqual({ success: false, error: 'batch_shift_noop', occurrenceId: null });
    expect(
      computeBatchShiftItems([timedSource({})], { dayShift: 400, newTime: null })
    ).toEqual({
      success: false,
      error: 'batch_shift_invalid',
      occurrenceId: null,
    });
    expect(
      computeBatchShiftItems([timedSource({})], { dayShift: 1, newTime: '25:00' })
    ).toEqual({
      success: false,
      error: 'batch_shift_invalid',
      occurrenceId: null,
    });
  });

  test('a structurally broken item aborts with its occurrence id (all-or-nothing)', () => {
    const result = computeBatchShiftItems(
      [timedSource({}), timedSource({ occurrenceId: 'broken', startAt: null })],
      { dayShift: 1, newTime: null }
    );
    expect(result).toEqual({
      success: false,
      error: 'batch_item_invalid',
      occurrenceId: 'broken',
    });
  });
});
