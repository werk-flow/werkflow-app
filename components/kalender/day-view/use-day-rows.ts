'use client';

import { useMemo } from 'react';
import { toLocalDateString } from '@/lib/utils';
import {
  boardDayKey,
  indexBoardDays,
  type CalendarBoardContext,
  type CalendarBoardDay,
  type CalendarBoardRow,
} from '@/lib/calendar/board';
import { groupBoardRows } from '@/lib/calendar/board-model';
import {
  DEFAULT_VISIT_MINUTES,
  DAY_MIN_ITEM_WIDTH,
  minutesIntoDay,
  packTimeLanes,
  type TimedItem,
  jobStartMinutes,
} from '@/lib/calendar/day-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  calculateCalendarWorkBlocks,
  getCalendarBlockDisplaySegments,
  type CalendarWorkBlock,
} from '@/lib/time-tracking/calendar-blocks';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { memberDisplayName, type CalendarMember } from '../members';
import { UNASSIGNED_USER } from '../board/types';
import type { TimeBlockSegment } from './time-block';
import type { DayRowModel } from './use-day-surface';

export type DayRowItem =
  | (TimedItem & { kind: 'block'; block: CalendarWorkBlock; segments: TimeBlockSegment[] })
  | (TimedItem & { kind: 'job'; job: CalendarJob });

/** One person's row on the day: the surface model, the board day, the timed items in lanes and the untimed tray. */
export type DayRow = {
  model: DayRowModel;
  boardDay: CalendarBoardDay | undefined;
  role: string | undefined;
  items: DayRowItem[];
  untimed: CalendarJob[];
  laneCount: number;
  lanes: ReturnType<typeof packTimeLanes<DayRowItem>>['lanes'];
};

/**
 * The day view's rows: an „Ohne Zuweisung" row for a manager when unassigned
 * visits exist, then the members in board order, each with its recorded
 * blocks and planned visits packed into lanes at the current zoom.
 */
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
  const boardRowByUser = useMemo(
    () => new Map(board.rows.flatMap((row) => (row.userId ? [[row.userId, row] as const] : []))),
    [board.rows],
  );
  // The board's order (teams, then names); a member without a board row on this date keeps the membership order at the end.
  const orderedMembers = useMemo(() => {
    const order = new Map(
      groupBoardRows({ rows: board.rows, includeUnassigned: false, memberUserIds: null, teamIds: [] })
        .flatMap((group) => group.rows)
        .flatMap((row, index) =>
          row.kind === 'person' && row.row.userId ? [[row.row.userId, index] as const] : [],
        ),
    );
    return [...members].sort(
      (left, right) =>
        (order.get(left.user_id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.user_id) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [board.rows, members]);
  const roleByUser = useMemo(
    () => new Map(members.map((member) => [member.user_id, member.role])),
    [members],
  );

  const dayJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.plannedDate &&
          job.plannedDate <= dateIso &&
          dateIso < (job.endDateExclusive ?? `${job.plannedDate}~`),
      ),
    [jobs, dateIso],
  );
  const dayEntries = useMemo(
    () => entries.filter((entry) => toLocalDateString(new Date(entry.timestamp)) === dateIso),
    [entries, dateIso],
  );

  const rows = useMemo(() => {
    const now = new Date(nowTick);
    const list: DayRow[] = [];
    const buildRow = (
      userId: string,
      name: string,
      row: CalendarBoardRow | null,
      rowJobs: CalendarJob[],
      rowEntries: TimeEntry[],
    ) => {
      const blocks = calculateCalendarWorkBlocks(rowEntries);
      const items: DayRowItem[] = [];
      for (const block of blocks) {
        const start = minutesIntoDay(new Date(block.start), dayStart);
        const end = block.end ? minutesIntoDay(new Date(block.end), dayStart) : minutesIntoDay(now, dayStart);
        const segments = getCalendarBlockDisplaySegments(block, now, organizationSettings).map((segment) => ({
          id: segment.id,
          type: segment.type,
          startMinutes: minutesIntoDay(new Date(segment.start), dayStart),
          endMinutes: segment.end ? minutesIntoDay(new Date(segment.end), dayStart) : end,
        }));
        items.push({ kind: 'block', key: block.id, block, segments, startMinutes: start, endMinutes: end });
      }
      const untimed: CalendarJob[] = [];
      for (const job of rowJobs) {
        if (!job.plannedTime || job.plannedDate !== dateIso) {
          untimed.push(job);
          continue;
        }
        const start = jobStartMinutes(job);
        items.push({
          kind: 'job',
          key: job.id,
          job,
          startMinutes: start,
          endMinutes: Math.min(24 * 60, start + (job.estimatedDurationMinutes ?? DEFAULT_VISIT_MINUTES)),
        });
      }
      const packed = packTimeLanes(items, (DAY_MIN_ITEM_WIDTH / hourWidth) * 60);
      list.push({
        model: {
          userId,
          name,
          row,
          blocks: blocks.map((block) => ({
            id: block.id,
            startMs: new Date(block.start).getTime(),
            endMs: block.end ? new Date(block.end).getTime() : now.getTime(),
          })),
        },
        boardDay: row ? days.get(boardDayKey(row.employeeRecordId, dateIso)) : undefined,
        role: roleByUser.get(userId),
        items,
        untimed,
        laneCount: Math.max(1, packed.laneCount),
        lanes: packed.lanes,
      });
    };
    if (isManager) {
      const unassigned = dayJobs.filter((job) => job.assignedUserIds.length === 0);
      if (unassigned.length > 0) buildRow(UNASSIGNED_USER, 'Ohne Zuweisung', null, unassigned, []);
    }
    for (const member of orderedMembers) {
      buildRow(
        member.user_id,
        memberDisplayName(member),
        boardRowByUser.get(member.user_id) ?? null,
        dayJobs.filter((job) => job.assignedUserIds.includes(member.user_id)),
        dayEntries.filter((entry) => entry.userId === member.user_id),
      );
    }
    return list;
  }, [
    isManager,
    boardRowByUser,
    dayEntries,
    dayJobs,
    dayStart,
    days,
    dateIso,
    orderedMembers,
    nowTick,
    organizationSettings,
    roleByUser,
    hourWidth,
  ]);

  return { days, rows };
}
