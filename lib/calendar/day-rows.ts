import { boardDayKey, type CalendarBoardDay, type CalendarBoardRow } from './board';
import { groupBoardRows, rowOwnsJob } from './board-model';
import {
  DAY_MIN_ITEM_WIDTH,
  DEFAULT_VISIT_MINUTES,
  jobStartMinutes,
  minutesIntoDay,
  packTimeLanes,
  type TimedItem,
  type TimedLaneItem,
} from './day-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import {
  calculateCalendarWorkBlocks,
  getCalendarBlockDisplaySegments,
  type CalendarWorkBlock,
} from '@/lib/time-tracking/calendar-blocks';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { toLocalDateString } from '@/lib/utils';

/**
 * The day view's rows (P1-24a), keyed like the board: one row per employee
 * record on the board, with or without a login, after an „Ohne Zuweisung"
 * row for a manager. A login only adds the person's recorded time and role.
 */

/** The key of the „Ohne Zuweisung" row; never an employee record id. */
export const UNASSIGNED_DAY_ROW_KEY = 'unassigned';

/** A login of the organization as the day view needs it. */
export type DayRowMember = { userId: string; name: string; role: string };

export type TimeBlockSegment = {
  id: string;
  type: 'work' | 'break';
  startMinutes: number;
  endMinutes: number;
};

export type DayRowModel = {
  /** The employee record id, `member:<user id>` for a login without a board row, or the unassigned key. */
  key: string;
  /** The person's login; null for a record without one and for the „Ohne Zuweisung" row. */
  userId: string | null;
  name: string;
  row: CalendarBoardRow | null;
  /** Recorded blocks of the person, as instants, for the overlap check. */
  blocks: Array<{ id: string; startMs: number; endMs: number }>;
};

export type DayRowItem =
  | (TimedItem & { kind: 'block'; block: CalendarWorkBlock; segments: TimeBlockSegment[] })
  | (TimedItem & { kind: 'job'; job: CalendarJob });

/** One row of the day: the surface model, the board day, the timed items in lanes and the untimed tray. */
export type DayRow = {
  model: DayRowModel;
  boardDay: CalendarBoardDay | undefined;
  role: string | undefined;
  items: DayRowItem[];
  untimed: CalendarJob[];
  laneCount: number;
  lanes: TimedLaneItem<DayRowItem>[];
};

export type DayRowsInput = {
  boardRows: readonly CalendarBoardRow[];
  days: ReadonlyMap<string, CalendarBoardDay>;
  /** The logins in the member scope. */
  members: readonly DayRowMember[];
  jobs: readonly CalendarJob[];
  entries: readonly TimeEntry[];
  dateIso: string;
  dayStart: Date;
  now: Date;
  organizationSettings: OrganizationTimeTrackingSettings;
  hourWidth: number;
  isManager: boolean;
};

type DayRowPerson = Omit<DayRowModel, 'blocks'> & { role: string | undefined };

/** The key of the row a drop target or a drag source names: the record first, then a login without a board row. */
export function dayRowKey(person: { employeeRecordId: string | null; userId: string | null }): string {
  if (person.employeeRecordId) return person.employeeRecordId;
  if (person.userId) return `member:${person.userId}`;
  return UNASSIGNED_DAY_ROW_KEY;
}

export function dayRowFor<Row extends { key: string }>(rows: readonly Row[], key: string): Row | null {
  return rows.find((candidate) => candidate.key === key) ?? null;
}

/** Visits belong to the rows of their assignees by record, as on the board; a login without a board row keeps its user id. */
export function dayRowOwnsJob(model: Pick<DayRowModel, 'key' | 'userId' | 'row'>, job: CalendarJob): boolean {
  if (model.row) return rowOwnsJob({ key: model.key, kind: 'person', row: model.row }, job);
  if (model.userId) return job.assignedUserIds.includes(model.userId);
  return rowOwnsJob({ key: UNASSIGNED_DAY_ROW_KEY, kind: 'unassigned', row: null }, job);
}

export function deriveDayRows(input: DayRowsInput): DayRow[] {
  const { dateIso } = input;
  const memberByUser = new Map(input.members.map((member) => [member.userId, member]));
  // A record with a login follows the member scope; one without a login shows under every selection, as on the board.
  const visibleRows = input.boardRows.filter(
    (row) => !row.hasLogin || (row.userId !== null && memberByUser.has(row.userId)),
  );
  const boardPeople = groupBoardRows({
    rows: visibleRows,
    includeUnassigned: false,
    memberUserIds: null,
    teamIds: [],
  })
    .flatMap((group) => group.rows)
    .flatMap((model): DayRowPerson[] => {
      if (model.kind !== 'person') return [];
      const userId = model.row.hasLogin ? model.row.userId : null;
      const member = userId ? memberByUser.get(userId) : undefined;
      return [
        {
          key: model.row.employeeRecordId,
          userId,
          name: member?.name ?? model.row.displayName,
          row: model.row,
          role: member?.role,
        },
      ];
    });
  const boardUserIds = new Set(boardPeople.flatMap((person) => (person.userId ? [person.userId] : [])));
  // A login without a board row on this date (or without a board at all) keeps the membership order at the end.
  const memberPeople = input.members
    .filter((member) => !boardUserIds.has(member.userId))
    .map(
      (member): DayRowPerson => ({
        key: dayRowKey({ employeeRecordId: null, userId: member.userId }),
        userId: member.userId,
        name: member.name,
        row: null,
        role: member.role,
      }),
    );

  const dayJobs = input.jobs.filter(
    (job) =>
      job.plannedDate &&
      job.plannedDate <= dateIso &&
      dateIso < (job.endDateExclusive ?? `${job.plannedDate}~`),
  );
  const dayEntries = input.entries.filter(
    (entry) => toLocalDateString(new Date(entry.timestamp)) === dateIso,
  );
  const rows = [...boardPeople, ...memberPeople].map((person) =>
    buildDayRow(
      input,
      person,
      dayJobs.filter((job) => dayRowOwnsJob(person, job)),
      person.userId ? dayEntries.filter((entry) => entry.userId === person.userId) : [],
    ),
  );
  if (!input.isManager) return rows;
  const unassigned: DayRowPerson = {
    key: UNASSIGNED_DAY_ROW_KEY,
    userId: null,
    name: 'Ohne Zuweisung',
    row: null,
    role: undefined,
  };
  const unassignedJobs = dayJobs.filter((job) => dayRowOwnsJob(unassigned, job));
  return unassignedJobs.length > 0 ? [buildDayRow(input, unassigned, unassignedJobs, []), ...rows] : rows;
}

/** One person's recorded blocks and planned visits, packed into lanes at the current zoom. */
function buildDayRow(
  input: DayRowsInput,
  person: DayRowPerson,
  rowJobs: readonly CalendarJob[],
  rowEntries: TimeEntry[],
): DayRow {
  const { dayStart, now, dateIso } = input;
  const blocks = calculateCalendarWorkBlocks(rowEntries);
  const items: DayRowItem[] = [];
  for (const block of blocks) {
    const start = minutesIntoDay(new Date(block.start), dayStart);
    const end = block.end ? minutesIntoDay(new Date(block.end), dayStart) : minutesIntoDay(now, dayStart);
    const segments = getCalendarBlockDisplaySegments(block, now, input.organizationSettings).map(
      (segment) => ({
        id: segment.id,
        type: segment.type,
        startMinutes: minutesIntoDay(new Date(segment.start), dayStart),
        endMinutes: segment.end ? minutesIntoDay(new Date(segment.end), dayStart) : end,
      }),
    );
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
  const packed = packTimeLanes(items, (DAY_MIN_ITEM_WIDTH / input.hourWidth) * 60);
  const { role, ...model } = person;
  return {
    model: {
      ...model,
      blocks: blocks.map((block) => ({
        id: block.id,
        startMs: new Date(block.start).getTime(),
        endMs: block.end ? new Date(block.end).getTime() : now.getTime(),
      })),
    },
    boardDay: person.row ? input.days.get(boardDayKey(person.row.employeeRecordId, dateIso)) : undefined,
    role,
    items,
    untimed,
    laneCount: Math.max(1, packed.laneCount),
    lanes: packed.lanes,
  };
}
