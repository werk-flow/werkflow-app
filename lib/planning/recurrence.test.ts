import { describe, expect, test } from 'bun:test';

import { materializeSeries, occurrenceIdentity } from './recurrence';
import type { PlanningSeriesDraft } from './types';

function draft(patch: Partial<PlanningSeriesDraft> = {}): PlanningSeriesDraft {
  return {
    entryKind: 'internal',
    internalType: 'meeting',
    jobId: null,
    title: 'Teamrunde',
    description: null,
    location: null,
    timeKind: 'timed',
    startsAtLocal: '2026-08-12T09:00',
    durationMinutes: 60,
    durationDays: null,
    timezone: 'Europe/Berlin',
    frequency: 'weekly',
    interval: 1,
    weekdays: [0, 4],
    monthDay: null,
    occurrenceCount: 4,
    untilLocalDate: null,
    ...patch,
  };
}

describe('planning recurrence materialization', () => {
  test('uses the selected weekdays in the start week and respects count', () => {
    const occurrences = materializeSeries(draft(), '2027-01-01');
    expect(occurrences.map((occurrence) => occurrence.originalStartLocal)).toEqual([
      '2026-08-14T09:00',
      '2026-08-17T09:00',
      '2026-08-21T09:00',
      '2026-08-24T09:00',
    ]);
  });

  test('skips invalid monthly dates instead of drifting into another month', () => {
    const occurrences = materializeSeries(
      draft({
        startsAtLocal: '2026-01-31T09:00',
        frequency: 'monthly',
        weekdays: null,
        monthDay: 31,
        occurrenceCount: 3,
      }),
      '2026-06-30'
    );
    expect(occurrences.map((occurrence) => occurrence.originalStartLocal)).toEqual([
      '2026-01-31T09:00',
      '2026-03-31T09:00',
      '2026-05-31T09:00',
    ]);
  });

  test('materializes an all-day multi-day occurrence with an exclusive end', () => {
    expect(
      materializeSeries(
        draft({
          timeKind: 'all_day',
          durationMinutes: null,
          durationDays: 3,
          frequency: 'daily',
          occurrenceCount: 2,
        }),
        '2026-12-31'
      )[0]
    ).toMatchObject({
      startDate: '2026-08-12',
      endDateExclusive: '2026-08-15',
      startAt: null,
      endAt: null,
    });
  });

  test('uses a stable logical identity', () => {
    const occurrences = materializeSeries(draft(), '2027-01-01');
    expect(
      occurrenceIdentity('org', 'lineage', occurrences[0].originalStartLocal)
    ).toBe('org:lineage:2026-08-14T09:00');
  });

  test('rejects non-advancing intervals and respects an inclusive until date', () => {
    expect(() => materializeSeries(draft({ interval: 0 }), '2027-01-01')).toThrow(
      'invalid_recurrence_interval'
    );
    expect(
      materializeSeries(
        draft({
          frequency: 'daily',
          weekdays: null,
          occurrenceCount: 10,
          untilLocalDate: '2026-08-14',
        }),
        '2027-01-01'
      ).map((occurrence) => occurrence.originalStartLocal)
    ).toEqual([
      '2026-08-12T09:00',
      '2026-08-13T09:00',
      '2026-08-14T09:00',
    ]);
  });

  test('terminates when every monthly candidate day is invalid', () => {
    expect(
      materializeSeries(
        draft({
          startsAtLocal: '2026-02-10T09:00',
          frequency: 'monthly',
          weekdays: null,
          monthDay: 31,
          interval: 12,
          occurrenceCount: 5,
        }),
        '2027-01-01'
      )
    ).toEqual([]);
  });
});
