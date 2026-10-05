'use client';

import { useMemo } from 'react';

import type {
  InteractiveCalendarSession,
  TimeEntry,
  WorkSession,
  WorkSessionBreak,
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { deriveBreaksFromEntries, sortTimeEntries } from './entry-details-timeline';

/** Everything the entry details dialog reads from its session prop. */
export type EntryDetailsSnapshot = {
  interactiveSession: InteractiveCalendarSession;
  isAutomaticBreakMode: boolean;
  sessionBreaks: WorkSessionBreak[];
  actualClockOutEntry: TimeEntry | null;
  startEntry: TimeEntry | null;
  clockInTimestamp: string | null;
  clockOutTimestamp: string | null;
  clockInDate: Date | null;
  clockOutDate: Date | null;
  sessionEntriesForReview: TimeEntry[];
  hasCanonicalSegment: boolean;
  blockReferenceDate: Date | null;
  employeeName: string | null;
  employeeRole: OrgRole | undefined;
  entryUserId: string | undefined;
  entryOrganizationId: string | null;
  isOrphan: boolean;
  isActiveBlock: boolean;
};

export function useEntryDetailsSession(session: WorkSession): EntryDetailsSnapshot {
  const interactiveSession = session as InteractiveCalendarSession;
  const isAutomaticBreakMode = interactiveSession.breakMode === 'automatic';

  const sourceEntries = useMemo(() => {
    if (interactiveSession.sourceEntries?.length) {
      return sortTimeEntries(interactiveSession.sourceEntries);
    }

    return sortTimeEntries([session.clockIn, session.clockOut].filter(Boolean) as TimeEntry[]);
  }, [interactiveSession.sourceEntries, session.clockIn, session.clockOut]);

  const sessionBreaks = useMemo(() => {
    if (interactiveSession.breaks?.length) {
      return interactiveSession.breaks;
    }

    return deriveBreaksFromEntries(sourceEntries);
  }, [interactiveSession.breaks, sourceEntries]);

  const actualClockOutEntry = useMemo(() => {
    return [...sourceEntries].reverse().find((entry) => entry.entryType === 'clock_out') ?? null;
  }, [sourceEntries]);

  const startEntry = session.clockIn ?? null;
  const clockInTimestamp = startEntry?.timestamp ?? null;
  const clockOutTimestamp = actualClockOutEntry?.timestamp ?? null;
  const clockInDate = useMemo(
    () => (clockInTimestamp ? new Date(clockInTimestamp) : null),
    [clockInTimestamp],
  );
  const clockOutDate = useMemo(
    () => (clockOutTimestamp ? new Date(clockOutTimestamp) : null),
    [clockOutTimestamp],
  );
  const sessionEntriesForReview = useMemo(
    () =>
      sourceEntries.filter(
        (entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index,
      ),
    [sourceEntries],
  );
  const hasCanonicalSegment = sessionEntriesForReview.some((entry) => entry.canonicalSegmentId);
  const blockReferenceDate = useMemo(
    () =>
      clockInDate ??
      clockOutDate ??
      (sessionBreaks[0] ? new Date(sessionBreaks[0].breakStart.timestamp) : null),
    [clockInDate, clockOutDate, sessionBreaks],
  );

  const employeeName = interactiveSession.employeeName ?? null;
  const entryUserId = sourceEntries[0]?.userId ?? session.clockIn?.userId ?? session.clockOut?.userId;
  const entryOrganizationId =
    sourceEntries[0]?.organizationId ??
    session.clockIn?.organizationId ??
    session.clockOut?.organizationId ??
    null;
  const isOrphan = session.isOrphan || !session.clockIn;
  const isActiveBlock = !isOrphan && !actualClockOutEntry;

  return {
    interactiveSession,
    isAutomaticBreakMode,
    sessionBreaks,
    actualClockOutEntry,
    startEntry,
    clockInTimestamp,
    clockOutTimestamp,
    clockInDate,
    clockOutDate,
    sessionEntriesForReview,
    hasCanonicalSegment,
    blockReferenceDate,
    employeeName,
    employeeRole: interactiveSession.employeeRole,
    entryUserId,
    entryOrganizationId,
    isOrphan,
    isActiveBlock,
  };
}
