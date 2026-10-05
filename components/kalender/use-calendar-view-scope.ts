'use client';

import { useMemo } from 'react';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import {
  boardTeamsOf,
  scopedEntries,
  scopedJobs,
  scopedMembers,
  scopedParkedJobs,
} from '@/lib/calendar/member-scope';
import { resolveShowActualTime, type CalendarPreferences } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { memberDisplayName, type CalendarMember } from './members';

/**
 * What the views draw after the member scope: null in the preferences means
 * everyone; a caller without the manager role sees only their own records.
 */
export function useCalendarViewScope({
  preferences,
  showWorkingHours,
  entries,
  calendarJobs,
  parkedJobs,
  members,
  boardRows,
  isAdminOrManager,
  currentUserId,
}: {
  preferences: CalendarPreferences;
  showWorkingHours: boolean;
  entries: TimeEntry[];
  calendarJobs: CalendarJob[];
  parkedJobs: CalendarJob[];
  members: CalendarMember[];
  boardRows: CalendarBoardRow[];
  isAdminOrManager: boolean;
  currentUserId: string;
}) {
  const selectedMemberIds = preferences.memberUserIds;
  const filteredEntries = useMemo(
    () =>
      scopedEntries(entries, showWorkingHours, {
        isManager: isAdminOrManager,
        currentUserId,
        selectedMemberIds,
      }),
    [entries, selectedMemberIds, isAdminOrManager, currentUserId, showWorkingHours],
  );
  const filteredMembers = useMemo(
    () => scopedMembers(members, { isManager: isAdminOrManager, currentUserId, selectedMemberIds }),
    [members, selectedMemberIds, isAdminOrManager, currentUserId],
  );
  const filteredJobs = useMemo(
    () =>
      scopedJobs(calendarJobs, preferences.showJobs, {
        isManager: isAdminOrManager,
        currentUserId,
        selectedMemberIds,
      }),
    [calendarJobs, preferences.showJobs, selectedMemberIds, isAdminOrManager, currentUserId],
  );
  const filteredParkedJobs = useMemo(
    () => scopedParkedJobs(parkedJobs, { isManager: isAdminOrManager, selectedMemberIds }),
    [parkedJobs, selectedMemberIds, isAdminOrManager],
  );
  const memberNameMap = useMemo(
    () => Object.fromEntries(members.map((member) => [member.user_id, memberDisplayName(member)])),
    [members],
  );
  const boardTeams = useMemo(() => boardTeamsOf(boardRows), [boardRows]);
  const showActualTime = resolveShowActualTime(preferences);
  return {
    selectedMemberIds,
    filteredEntries,
    filteredMembers,
    filteredJobs,
    filteredParkedJobs,
    memberNameMap,
    boardTeams,
    showActualTime,
  };
}

export type CalendarViewScope = ReturnType<typeof useCalendarViewScope>;
