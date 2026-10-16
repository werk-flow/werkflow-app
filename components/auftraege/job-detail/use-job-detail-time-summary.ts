'use client';

import { useCallback, useMemo } from 'react';
import { useWallClockTick } from '@/hooks/use-wall-clock-tick';
import { liveMinutes } from '@/lib/time-tracking/helpers';
import type { JobTimeParticipant, TimeEntry } from '@/lib/time-tracking/types';
import type { JobAssignmentWithProfile } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { getSessionPersonName } from './job-detail-person';
import {
  collectJobSessionPeople,
  collectJobWorkSessions,
  sumJobMinutesPerEmployee,
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

  // The durations are whole minutes: a minute tick keeps them less than a minute behind.
  const nowTick = useWallClockTick(60_000, activeWorkSessions.length > 0);

  const getSessionDurationMinutes = useCallback(
    (session: { clockIn: TimeEntry | null; clockOut: TimeEntry | null; durationMinutes: number | null }) => {
      if (session.durationMinutes !== null) return session.durationMinutes;
      if (!session.clockIn || session.clockOut) return 0;

      return Math.floor(liveMinutes(0, session.clockIn.timestamp, nowTick));
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
