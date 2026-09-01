import { describe, expect, test } from 'bun:test';

import {
  calculateTimeActivityTotals,
  createActivitySelection,
  getSegmentDurationMinutes,
  projectTimeSegmentsToLegacyTransitions,
  splitSegmentAtLocalDayBoundaries,
  toTimeSegmentFact,
} from './segments';
import type { TimeSegmentFact } from './segments';

function segment(
  kind: TimeSegmentFact['kind'],
  startedAt: string,
  endedAt: string | null
): TimeSegmentFact {
  return {
    ...createActivitySelection(kind),
    id: crypto.randomUUID(),
    sessionId: 'session',
    organizationId: 'organization',
    employeeRecordId: 'employee',
    startedAt,
    endedAt,
  };
}

describe('canonical time segment projections', () => {
  test('validates and maps activity-specific segment facts', () => {
    const baseRow: Parameters<typeof toTimeSegmentFact>[0] = {
      id: 'segment',
      session_id: 'session',
      organization_id: 'organization',
      employee_record_id: 'employee',
      kind: 'travel',
      allocation_kind: 'unallocated',
      job_id: null,
      internal_type: null,
      travel_route: 'site_to_site',
      travel_role: 'driver',
      standby_context: null,
      started_at: '2026-08-31T08:00:00.000Z',
      ended_at: '2026-08-31T08:30:00.000Z',
    };

    expect(toTimeSegmentFact(baseRow)).toMatchObject({
      kind: 'travel',
      allocationKind: 'unallocated',
      travelRoute: 'site_to_site',
      travelRole: 'driver',
    });
    expect(toTimeSegmentFact({
      ...baseRow,
      kind: 'standby',
      allocation_kind: 'none',
      travel_route: null,
      travel_role: null,
      standby_context: 'remote',
    })).toMatchObject({
      kind: 'standby',
      allocationKind: 'none',
      standbyContext: 'remote',
    });
    expect(toTimeSegmentFact({
      ...baseRow,
      kind: 'internal_activity',
      allocation_kind: 'internal_activity',
      internal_type: 'training',
      travel_route: null,
      travel_role: null,
    })).toMatchObject({
      kind: 'internal_activity',
      allocationKind: 'internal_activity',
      internalType: 'training',
    });
    expect(() => toTimeSegmentFact({
      ...baseRow,
      allocation_kind: 'none',
    })).toThrow('Invalid canonical time segment shape: segment');
  });

  test('clamps duration to the requested range', () => {
    const minutes = getSegmentDurationMinutes(
      segment('work', '2026-08-30T21:00:00.000Z', '2026-08-31T06:00:00.000Z'),
      new Date('2026-08-30T22:00:00.000Z'),
      new Date('2026-08-31T22:00:00.000Z')
    );
    expect(minutes).toBe(480);
  });

  test('splits an overnight segment at Europe/Berlin midnight', () => {
    expect(
      splitSegmentAtLocalDayBoundaries(
        segment('work', '2026-08-30T21:30:00.000Z', '2026-08-31T01:30:00.000Z'),
        new Date('2026-08-30T00:00:00.000Z'),
        new Date('2026-09-01T00:00:00.000Z')
      )
    ).toEqual([
      {
        startedAt: '2026-08-30T21:30:00.000Z',
        endedAt: '2026-08-30T22:00:00.000Z',
      },
      {
        startedAt: '2026-08-30T22:00:00.000Z',
        endedAt: '2026-08-31T01:30:00.000Z',
      },
    ]);
  });

  test('uses the CET-to-CEST boundary when splitting a DST night', () => {
    expect(
      splitSegmentAtLocalDayBoundaries(
        segment('work', '2026-03-28T22:30:00.000Z', '2026-03-29T02:30:00.000Z'),
        new Date('2026-03-28T00:00:00.000Z'),
        new Date('2026-03-30T00:00:00.000Z')
      )
    ).toEqual([
      {
        startedAt: '2026-03-28T22:30:00.000Z',
        endedAt: '2026-03-28T23:00:00.000Z',
      },
      {
        startedAt: '2026-03-28T23:00:00.000Z',
        endedAt: '2026-03-29T02:30:00.000Z',
      },
    ]);
  });

  test('closes an open segment at a historical range boundary', () => {
    expect(
      splitSegmentAtLocalDayBoundaries(
        segment('work', '2026-08-31T08:00:00.000Z', null),
        new Date('2026-08-31T00:00:00.000Z'),
        new Date('2026-08-31T10:00:00.000Z'),
        new Date('2026-08-31T12:00:00.000Z')
      )
    ).toEqual([
      {
        startedAt: '2026-08-31T08:00:00.000Z',
        endedAt: '2026-08-31T10:00:00.000Z',
      },
    ]);
  });

  test('keeps factual activity totals separate', () => {
    const rangeStart = new Date('2026-08-31T00:00:00.000Z');
    const rangeEnd = new Date('2026-09-01T00:00:00.000Z');
    const segments = [
      segment('work', '2026-08-31T08:00:00.000Z', '2026-08-31T09:00:00.000Z'),
      segment('travel', '2026-08-31T09:00:00.000Z', '2026-08-31T09:30:00.000Z'),
      segment('break', '2026-08-31T09:30:00.000Z', '2026-08-31T09:45:00.000Z'),
      segment('standby', '2026-08-31T09:45:00.000Z', '2026-08-31T10:00:00.000Z'),
      segment('callout', '2026-08-31T10:00:00.000Z', '2026-08-31T10:30:00.000Z'),
      segment('internal_activity', '2026-08-31T10:30:00.000Z', '2026-08-31T11:00:00.000Z'),
    ];

    expect(calculateTimeActivityTotals(segments, rangeStart, rangeEnd)).toEqual({
      presenceMinutes: 180,
      workMinutes: 60,
      breakMinutes: 15,
      travelMinutes: 30,
      standbyMinutes: 15,
      calloutMinutes: 30,
      internalMinutes: 30,
    });
  });

  test('projects work and break switches without closing attendance', () => {
    const segments = [
      segment('work', '2026-08-31T08:00:00.000Z', '2026-08-31T10:00:00.000Z'),
      segment('break', '2026-08-31T10:00:00.000Z', '2026-08-31T10:15:00.000Z'),
      segment('work', '2026-08-31T10:15:00.000Z', null),
    ].map((fact, index) => ({ ...fact, id: `segment-${index}` }));

    expect(
      projectTimeSegmentsToLegacyTransitions(
        segments,
        new Date('2026-08-31T00:00:00.000Z'),
        new Date('2026-09-01T00:00:00.000Z'),
        new Date('2026-08-31T11:00:00.000Z')
      ).map(({ entryType, timestamp }) => ({ entryType, timestamp }))
    ).toEqual([
      { entryType: 'clock_in', timestamp: '2026-08-31T08:00:00.000Z' },
      { entryType: 'break_start', timestamp: '2026-08-31T10:00:00.000Z' },
      { entryType: 'break_end', timestamp: '2026-08-31T10:15:00.000Z' },
    ]);
  });

  test('ends a session that closes during a break in valid order', () => {
    const segments = [
      segment('work', '2026-08-31T08:00:00.000Z', '2026-08-31T10:00:00.000Z'),
      segment('break', '2026-08-31T10:00:00.000Z', '2026-08-31T10:15:00.000Z'),
    ].map((fact, index) => ({ ...fact, id: `segment-${index}` }));

    expect(
      projectTimeSegmentsToLegacyTransitions(
        segments,
        new Date('2026-08-31T00:00:00.000Z'),
        new Date('2026-09-01T00:00:00.000Z')
      ).map(({ entryType }) => entryType)
    ).toEqual(['clock_in', 'break_start', 'break_end', 'clock_out']);
  });

  test('balances overnight slices and distinct sessions independently', () => {
    const overnight = {
      ...segment('work', '2026-08-30T21:30:00.000Z', '2026-08-31T01:30:00.000Z'),
      id: 'overnight-segment',
      sessionId: 'overnight-session',
    };
    const second = {
      ...segment('travel', '2026-08-31T00:15:00.000Z', '2026-08-31T00:45:00.000Z'),
      id: 'second-segment',
      sessionId: 'second-session',
    };
    const points = projectTimeSegmentsToLegacyTransitions(
      [overnight, second],
      new Date('2026-08-30T00:00:00.000Z'),
      new Date('2026-09-01T00:00:00.000Z')
    );

    const overnightTypes = points
      .filter((point) => point.segmentId === overnight.id)
      .map((point) => point.entryType);
    const secondTypes = points
      .filter((point) => point.segmentId === second.id)
      .map((point) => point.entryType);
    expect(overnightTypes).toEqual([
      'clock_in',
      'clock_out',
      'clock_in',
      'clock_out',
    ]);
    expect(secondTypes).toEqual(['clock_in', 'clock_out']);
  });

  test('orders adjacent work-segment switches at one timestamp', () => {
    const segments = [
      segment('work', '2026-08-31T08:00:00.000Z', '2026-08-31T09:00:00.000Z'),
      segment('work', '2026-08-31T09:00:00.000Z', '2026-08-31T10:00:00.000Z'),
    ].map((fact, index) => ({ ...fact, id: `work-${index}` }));

    expect(
      projectTimeSegmentsToLegacyTransitions(
        segments,
        new Date('2026-08-31T00:00:00.000Z'),
        new Date('2026-09-01T00:00:00.000Z')
      ).map((point) => point.entryType)
    ).toEqual(['clock_in', 'clock_out', 'clock_in', 'clock_out']);
  });
});
