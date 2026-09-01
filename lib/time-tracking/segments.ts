import type {
  TimeActivitySelection,
  TimeAllocationKind,
  TimeInternalActivity,
  TimeSegmentKind,
  TimeEntryType,
  TimeStandbyContext,
  TimeTravelRole,
  TimeTravelRoute,
} from './types';
import { getLocalDayEnd } from './day-utils';

export type TimeSegmentFact = TimeActivitySelection & {
  id: string;
  sessionId: string;
  organizationId: string;
  employeeRecordId: string;
  startedAt: string;
  endedAt: string | null;
};

export type TimeActivityTotals = {
  presenceMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  travelMinutes: number;
  standbyMinutes: number;
  calloutMinutes: number;
  internalMinutes: number;
};

export type TimeSegmentProjectionPoint = {
  segmentId: string;
  sliceIndex: number;
  entryType: TimeEntryType;
  timestamp: string;
};

type SegmentRow = {
  id: string;
  session_id: string;
  organization_id: string;
  employee_record_id: string;
  kind: TimeSegmentKind;
  allocation_kind: TimeAllocationKind;
  job_id: string | null;
  internal_type: TimeInternalActivity | null;
  travel_route: TimeTravelRoute | null;
  travel_role: TimeTravelRole | null;
  standby_context: TimeStandbyContext | null;
  started_at: string;
  ended_at: string | null;
};

export function toTimeSegmentFact(row: SegmentRow): TimeSegmentFact {
  let selection: TimeActivitySelection;
  switch (row.kind) {
    case 'work':
    case 'callout':
      selection = row.allocation_kind === 'job' && row.job_id
        ? { kind: row.kind, allocationKind: 'job', jobId: row.job_id }
        : row.allocation_kind === 'unallocated' && row.job_id === null
          ? { kind: row.kind, allocationKind: 'unallocated', jobId: null }
          : invalidSegmentShape(row);
      break;
    case 'travel':
      if (!row.travel_route || !row.travel_role) return invalidSegmentShape(row);
      selection = row.allocation_kind === 'job' && row.job_id
        ? {
            kind: 'travel',
            allocationKind: 'job',
            jobId: row.job_id,
            travelRoute: row.travel_route,
            travelRole: row.travel_role,
          }
        : row.allocation_kind === 'unallocated' && row.job_id === null
          ? {
              kind: 'travel',
              allocationKind: 'unallocated',
              jobId: null,
              travelRoute: row.travel_route,
              travelRole: row.travel_role,
            }
          : invalidSegmentShape(row);
      break;
    case 'break':
      selection = row.allocation_kind === 'none'
        ? { kind: 'break', allocationKind: 'none' }
        : invalidSegmentShape(row);
      break;
    case 'standby':
      selection = row.allocation_kind === 'none' && row.standby_context
        ? {
            kind: 'standby',
            allocationKind: 'none',
            standbyContext: row.standby_context,
          }
        : invalidSegmentShape(row);
      break;
    case 'internal_activity':
      selection = row.allocation_kind === 'internal_activity' && row.internal_type
        ? {
            kind: 'internal_activity',
            allocationKind: 'internal_activity',
            internalType: row.internal_type,
          }
        : invalidSegmentShape(row);
      break;
    default:
      return invalidSegmentShape(row);
  }

  return {
    ...selection,
    id: row.id,
    sessionId: row.session_id,
    organizationId: row.organization_id,
    employeeRecordId: row.employee_record_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function invalidSegmentShape(row: SegmentRow): never {
  throw new Error(`Invalid canonical time segment shape: ${row.id}`);
}

export function getSegmentDurationMinutes(
  segment: Pick<TimeSegmentFact, 'startedAt' | 'endedAt'>,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date()
): number {
  const startMs = Math.max(new Date(segment.startedAt).getTime(), rangeStart.getTime());
  const endMs = Math.min(
    new Date(segment.endedAt ?? now.toISOString()).getTime(),
    rangeEnd.getTime()
  );
  return Math.max(0, (endMs - startMs) / 60_000);
}

export function calculateTimeActivityTotals(
  segments: readonly TimeSegmentFact[],
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date()
): TimeActivityTotals {
  const totals: TimeActivityTotals = {
    presenceMinutes: 0,
    workMinutes: 0,
    breakMinutes: 0,
    travelMinutes: 0,
    standbyMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
  };

  for (const segment of segments) {
    const minutes = getSegmentDurationMinutes(segment, rangeStart, rangeEnd, now);
    totals.presenceMinutes += minutes;
    switch (segment.kind) {
      case 'work':
        totals.workMinutes += minutes;
        break;
      case 'break':
        totals.breakMinutes += minutes;
        break;
      case 'travel':
        totals.travelMinutes += minutes;
        break;
      case 'standby':
        totals.standbyMinutes += minutes;
        break;
      case 'callout':
        totals.calloutMinutes += minutes;
        break;
      case 'internal_activity':
        totals.internalMinutes += minutes;
        break;
    }
  }

  return totals;
}

export function isProductiveActivity(kind: TimeSegmentKind): boolean {
  return kind !== 'break' && kind !== 'standby';
}

export function createActivitySelection(
  kind: TimeActivitySelection['kind'],
  jobId: string | null = null
): TimeActivitySelection {
  if (kind === 'break') {
    return { kind, allocationKind: 'none' };
  }
  if (kind === 'standby') {
    return { kind, allocationKind: 'none', standbyContext: 'unspecified' };
  }
  if (kind === 'travel') {
    return jobId
      ? { kind, allocationKind: 'job', jobId, travelRoute: 'unspecified', travelRole: 'unspecified' }
      : { kind, allocationKind: 'unallocated', jobId: null, travelRoute: 'unspecified', travelRole: 'unspecified' };
  }
  if (kind === 'internal_activity') {
    return { kind, allocationKind: 'internal_activity', internalType: 'internal_work' };
  }
  return jobId
    ? { kind, allocationKind: 'job', jobId }
    : { kind, allocationKind: 'unallocated', jobId: null };
}

export function toTimeActivitySelection(
  segment: TimeSegmentFact
): TimeActivitySelection {
  switch (segment.kind) {
    case 'work':
    case 'callout':
      return segment.allocationKind === 'job'
        ? { kind: segment.kind, allocationKind: 'job', jobId: segment.jobId }
        : { kind: segment.kind, allocationKind: 'unallocated', jobId: null };
    case 'travel':
      return segment.allocationKind === 'job'
        ? {
            kind: 'travel',
            allocationKind: 'job',
            jobId: segment.jobId,
            travelRoute: segment.travelRoute,
            travelRole: segment.travelRole,
          }
        : {
            kind: 'travel',
            allocationKind: 'unallocated',
            jobId: null,
            travelRoute: segment.travelRoute,
            travelRole: segment.travelRole,
          };
    case 'break':
      return { kind: 'break', allocationKind: 'none' };
    case 'standby':
      return {
        kind: 'standby',
        allocationKind: 'none',
        standbyContext: segment.standbyContext,
      };
    case 'internal_activity':
      return {
        kind: 'internal_activity',
        allocationKind: 'internal_activity',
        internalType: segment.internalType,
      };
  }
}

export function splitSegmentAtLocalDayBoundaries(
  segment: Pick<TimeSegmentFact, 'startedAt' | 'endedAt'>,
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date()
): Array<{ startedAt: string; endedAt: string | null }> {
  let cursorMs = Math.max(new Date(segment.startedAt).getTime(), rangeStart.getTime());
  const segmentEndMs = Math.min(
    new Date(segment.endedAt ?? now.toISOString()).getTime(),
    rangeEnd.getTime()
  );
  const slices: Array<{ startedAt: string; endedAt: string | null }> = [];

  while (cursorMs < segmentEndMs) {
    const nextDayStartMs = getLocalDayEnd(new Date(cursorMs)).getTime() + 1;
    const sliceEndMs = Math.min(segmentEndMs, nextDayStartMs);
    const isOpenTail =
      segment.endedAt === null &&
      now.getTime() <= rangeEnd.getTime() &&
      sliceEndMs === segmentEndMs;
    slices.push({
      startedAt: new Date(cursorMs).toISOString(),
      endedAt: isOpenTail ? null : new Date(sliceEndMs).toISOString(),
    });
    cursorMs = sliceEndMs;
  }
  return slices;
}

/**
 * Projects canonical facts into the valid state transitions expected by legacy
 * read models. Adjacent segments are one continuous attendance session, so a
 * break switch must not first close that session.
 */
export function projectTimeSegmentsToLegacyTransitions(
  segments: readonly TimeSegmentFact[],
  rangeStart: Date,
  rangeEnd: Date,
  now = new Date()
): TimeSegmentProjectionPoint[] {
  const points: TimeSegmentProjectionPoint[] = [];
  const segmentsBySession = new Map<string, TimeSegmentFact[]>();

  for (const segment of segments) {
    const sessionSegments = segmentsBySession.get(segment.sessionId) ?? [];
    sessionSegments.push(segment);
    segmentsBySession.set(segment.sessionId, sessionSegments);
  }

  for (const sessionSegments of segmentsBySession.values()) {
    const slices = sessionSegments
      .sort(
        (left, right) =>
          new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime()
      )
      .flatMap((segment) =>
        splitSegmentAtLocalDayBoundaries(segment, rangeStart, rangeEnd, now).map(
          (slice, sliceIndex) => ({ segment, slice, sliceIndex })
        )
      );

    for (const [index, current] of slices.entries()) {
      const previous = slices[index - 1];
      const next = slices[index + 1];
      const followsPreviousSegment = Boolean(
        previous &&
          previous.segment.id !== current.segment.id &&
          previous.slice.endedAt === current.slice.startedAt
      );

      if (!previous || !followsPreviousSegment) {
        pushProjectionPoint(points, current, 'clock_in', current.slice.startedAt);
        if (current.segment.kind === 'break') {
          pushProjectionPoint(points, current, 'break_start', current.slice.startedAt);
        }
      } else if (previous.segment.kind === 'break' && current.segment.kind !== 'break') {
        pushProjectionPoint(points, current, 'break_end', current.slice.startedAt);
      } else if (previous.segment.kind !== 'break' && current.segment.kind === 'break') {
        pushProjectionPoint(points, current, 'break_start', current.slice.startedAt);
      } else if (previous.segment.kind !== 'break' && current.segment.kind !== 'break') {
        pushProjectionPoint(points, previous, 'clock_out', current.slice.startedAt);
        pushProjectionPoint(points, current, 'clock_in', current.slice.startedAt);
      }

      if (!current.slice.endedAt) continue;
      const continuesWithNextSegment = Boolean(
        next &&
          next.segment.id !== current.segment.id &&
          next.slice.startedAt === current.slice.endedAt
      );
      if (continuesWithNextSegment) continue;

      if (current.segment.kind === 'break') {
        pushProjectionPoint(points, current, 'break_end', current.slice.endedAt);
      }
      pushProjectionPoint(points, current, 'clock_out', current.slice.endedAt);
    }
  }

  return points.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
}

function pushProjectionPoint(
  points: TimeSegmentProjectionPoint[],
  slice: {
    segment: TimeSegmentFact;
    sliceIndex: number;
  },
  entryType: TimeEntryType,
  timestamp: string
): void {
  points.push({
    segmentId: slice.segment.id,
    sliceIndex: slice.sliceIndex,
    entryType,
    timestamp,
  });
}
