'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { JobAssignmentWithProfile } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { getSessionPersonName } from './job-detail-person';
import {
  collectJobSessionPeople,
  collectJobWorkSessions,
  sumJobMinutesPerEmployee,
  type JobTimeParticipant,
} from './job-detail-time-sessions';

type JobDetailTimeSummaryInput = {
  jobId: string;
  assignments: JobAssignmentWithProfile[];
  members: OrgMemberOption[];
  timeEntries: TimeEntry[];
  timeParticipants: JobTimeParticipant[];
};

/** Derives the sessions, live durations and per-employee sums of one job from its time entries. */
export function useJobDetailTimeSummary({
  jobId,
  assignments,
  members,
  timeEntries,
  timeParticipants,
}: JobDetailTimeSummaryInput) {
  const [nowTick, setNowTick] = useState(() => Date.now());

  const sessionPeople = useMemo(
    () => collectJobSessionPeople(members, assignments, timeParticipants),
    [assignments, members, timeParticipants],
  );

  const allSessions = useMemo(() => collectJobWorkSessions(timeEntries, jobId), [jobId, timeEntries]);

  const activeWorkSessions = useMemo(
    () =>
      allSessions.filter(
        (session) => session.clockIn && !session.clockOut && !session.isOrphan && session.jobId === jobId,
      ),
    [allSessions, jobId],
  );

  useEffect(() => {
    if (activeWorkSessions.length === 0) return;

    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = window.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [activeWorkSessions.length]);

  const getSessionDurationMinutes = useCallback(
    (session: { clockIn: TimeEntry | null; clockOut: TimeEntry | null; durationMinutes: number | null }) => {
      if (session.durationMinutes !== null) return session.durationMinutes;
      if (!session.clockIn || session.clockOut) return 0;

      const startMs = new Date(session.clockIn.timestamp).getTime();
      return Math.max(0, Math.floor((nowTick - startMs) / 60000));
    },
    [nowTick],
  );

  const totalMinutes = useMemo(
    () => allSessions.reduce((sum, session) => sum + getSessionDurationMinutes(session), 0),
    [allSessions, getSessionDurationMinutes],
  );

  const perEmployeeMinutes = useMemo(
    () => sumJobMinutesPerEmployee(allSessions, sessionPeople, getSessionDurationMinutes),
    [allSessions, getSessionDurationMinutes, sessionPeople],
  );

  const activeWorkers = useMemo(
    () =>
      activeWorkSessions.map((session) => {
        const userId = session.clockIn.userId;
        const person = sessionPeople.get(userId);
        return {
          userId,
          clockIn: session.clockIn,
          name: getSessionPersonName(person),
          person: person ?? null,
          isPending: session.pendingState === 'full' || session.pendingState === 'partial',
          liveMinutes: getSessionDurationMinutes(session),
        };
      }),
    [activeWorkSessions, getSessionDurationMinutes, sessionPeople],
  );

  return {
    sessionPeople,
    allSessions,
    getSessionDurationMinutes,
    totalMinutes,
    perEmployeeMinutes,
    activeWorkers,
  };
}

export type JobDetailTimeSummary = ReturnType<typeof useJobDetailTimeSummary>;
