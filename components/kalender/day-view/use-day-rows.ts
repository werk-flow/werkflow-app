'use client';

import { useMemo } from 'react';
import { indexBoardDays, type CalendarBoardContext, type CalendarBoardDay } from '@/lib/calendar/board';
import { deriveDayRows, type DayRow } from '@/lib/calendar/day-rows';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { memberDisplayName, type CalendarMember } from '../members';

/** The day view's rows at the current zoom and minute; `deriveDayRows` owns the rule. */
export function useDayRows({
  board,
  members,
  jobs,
  entries,
  dateIso,
  dayStart,
  nowTick,
  organizationSettings,
  hourWidth,
  isManager,
}: {
  board: CalendarBoardContext;
  members: CalendarMember[];
  jobs: CalendarJob[];
  entries: TimeEntry[];
  dateIso: string;
  dayStart: Date;
  nowTick: number;
  organizationSettings: OrganizationTimeTrackingSettings;
  hourWidth: number;
  isManager: boolean;
}): { days: ReadonlyMap<string, CalendarBoardDay>; rows: DayRow[] } {
  const days = useMemo(() => indexBoardDays(board.days), [board.days]);
  const dayMembers = useMemo(
    () =>
      members.map((member) => ({
        userId: member.user_id,
        name: memberDisplayName(member),
        role: member.role,
      })),
    [members],
  );
  const rows = useMemo(
    () =>
      deriveDayRows({
        boardRows: board.rows,
        days,
        members: dayMembers,
        jobs,
        entries,
        dateIso,
        dayStart,
        now: new Date(nowTick),
        organizationSettings,
        hourWidth,
        isManager,
      }),
    [
      board.rows,
      days,
      dayMembers,
      jobs,
      entries,
      dateIso,
      dayStart,
      nowTick,
      organizationSettings,
      hourWidth,
      isManager,
    ],
  );
  return { days, rows };
}
