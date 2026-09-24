import type { CalendarBoardRow, CalendarDispatchState } from './board';
import { minutesOfDay, type BoardSpanItem } from './board-layout';
import type { CalendarJob } from '@/lib/jobs/types';
import { addLocalDays, formatBerlinLocalDate } from '@/lib/planning/date-time';
import type { SicknessCalendarEntry } from '@/lib/sickness/actions';
import { calculateCalendarWorkBlocks } from '@/lib/time-tracking/calendar-blocks';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { toLocalDateString } from '@/lib/utils';
import type { VacationCalendarEntry } from '@/lib/vacation/actions';

/**
 * Pure model of the Plantafel (P1-24a): which rows exist, which cards each
 * row shows, and the bars and time totals beside them. Everything a test
 * can prove without a browser lives here; the components only render.
 */

const UNASSIGNED_ROW_KEY = 'unassigned';
const NO_TEAM_KEY = 'no-team';

export type BoardRowModel =
  | { key: string; kind: 'person'; row: CalendarBoardRow }
  | { key: typeof UNASSIGNED_ROW_KEY; kind: 'unassigned'; row: null };

export type BoardTeamGroup = { key: string; name: string; rows: BoardRowModel[] };

export function groupBoardRows(input: {
  rows: readonly CalendarBoardRow[];
  includeUnassigned: boolean;
  memberUserIds: readonly string[] | null;
  teamIds: readonly string[];
}): BoardTeamGroup[] {
  const groups = new Map<string, BoardTeamGroup>();
  if (input.includeUnassigned) {
    groups.set(UNASSIGNED_ROW_KEY, { key: UNASSIGNED_ROW_KEY, name: 'Ohne Zuweisung', rows: [{ key: UNASSIGNED_ROW_KEY, kind: 'unassigned', row: null }] });
  }
  const visibleRows = input.rows.filter((row) => {
    if (input.memberUserIds && (!row.userId || !input.memberUserIds.includes(row.userId)) && row.userId !== null) return false;
    if (input.teamIds.length > 0 && !(row.teamId && input.teamIds.includes(row.teamId))) return false;
    return true;
  });
  const teamOrder = [...new Map(visibleRows.filter((row) => row.teamId).map((row) => [row.teamId ?? '', row.teamName ?? ''])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1], 'de'));
  for (const [teamId, teamName] of teamOrder) groups.set(teamId, { key: teamId, name: teamName, rows: [] });
  groups.set(NO_TEAM_KEY, { key: NO_TEAM_KEY, name: 'Ohne Team', rows: [] });
  for (const row of [...visibleRows].sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))) {
    const group = groups.get(row.teamId ?? NO_TEAM_KEY);
    group?.rows.push({ key: row.employeeRecordId, kind: 'person', row });
  }
  return [...groups.values()].filter((group) => group.rows.length > 0);
}

/** Cards belong to the rows of their assignees; legacy jobs know only user ids. */
export function rowOwnsJob(model: BoardRowModel, job: CalendarJob): boolean {
  const recordIds = job.assignedEmployeeRecordIds ?? [];
  const userIds = job.assignedUserIds;
  if (model.kind === 'unassigned') return recordIds.length === 0 && userIds.length === 0;
  if (recordIds.length > 0) return recordIds.includes(model.row.employeeRecordId);
  return model.row.userId !== null && userIds.includes(model.row.userId);
}

export function matchesBoardSearch(job: CalendarJob, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('de');
  if (!needle) return true;
  return [job.title, job.clientName, job.jobNumber, job.location, job.projectName]
    .some((value) => value?.toLocaleLowerCase('de').includes(needle));
}

export function occurrenceSpan(job: CalendarJob): BoardSpanItem | null {
  if (!job.plannedDate) return null;
  const startDate = job.startAt ? formatBerlinLocalDate(job.startAt) : job.plannedDate;
  const endDateExclusive = job.endDateExclusive
    ?? (job.endAt ? addLocalDays(formatBerlinLocalDate(new Date(new Date(job.endAt).getTime() - 1)), 1) : addLocalDays(startDate, 1));
  return { key: job.id, startDate, endDateExclusive: endDateExclusive > startDate ? endDateExclusive : addLocalDays(startDate, 1), sortMinutes: job.plannedTime ? minutesOfDay(job.plannedTime) : -1 };
}

export type BoardAbsenceItem = BoardSpanItem & {
  kind: 'vacation' | 'sickness';
  pending: boolean;
  label: string;
};

export function absenceItems(input: {
  vacation: readonly VacationCalendarEntry[];
  sickness: readonly SicknessCalendarEntry[];
  /** One person's absences on the board; null lists everyone's (the month). */
  employeeRecordId: string | null;
}): BoardAbsenceItem[] {
  const items: BoardAbsenceItem[] = [];
  for (const entry of input.vacation) {
    if (input.employeeRecordId !== null && entry.employeeRecordId !== input.employeeRecordId) continue;
    const half = entry.dayPortion === 'half_day' ? ' (halber Tag)' : '';
    items.push({ key: `vacation:${entry.id}`, startDate: entry.startDate, endDateExclusive: addLocalDays(entry.endDate, 1), sortMinutes: -2, kind: 'vacation', pending: entry.status === 'pending', label: `Urlaub – ${entry.personName}${half}${entry.status === 'pending' ? ' (angefragt)' : ''}` });
  }
  for (const entry of input.sickness) {
    if (input.employeeRecordId !== null && entry.employeeRecordId !== input.employeeRecordId) continue;
    const half = entry.dayPortion === 'half_day' ? ' (halber Tag)' : '';
    items.push({ key: `sickness:${entry.id}`, startDate: entry.startDate, endDateExclusive: addLocalDays(entry.endDate, 1), sortMinutes: -2, kind: 'sickness', pending: false, label: `Abwesend – ${entry.personName}${half}${entry.openEnded ? ' (bis auf Weiteres)' : ''}` });
  }
  return items;
}

/** Recorded time per person and local date, with the provisional flag, for the actual-time strip. */
export function actualMinutesByUserDate(entries: readonly TimeEntry[], now = new Date()): Map<string, { minutes: number; pending: boolean }> {
  const byUser = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const list = byUser.get(entry.userId) ?? [];
    list.push(entry);
    byUser.set(entry.userId, list);
  }
  const totals = new Map<string, { minutes: number; pending: boolean }>();
  for (const [userId, userEntries] of byUser) {
    for (const block of calculateCalendarWorkBlocks(userEntries)) {
      const start = new Date(block.start);
      const end = block.end ? new Date(block.end) : now;
      const date = toLocalDateString(start);
      const key = `${userId}:${date}`;
      const current = totals.get(key) ?? { minutes: 0, pending: false };
      current.minutes += Math.max(0, (end.getTime() - start.getTime()) / 60_000);
      current.pending = current.pending || block.isPending;
      totals.set(key, current);
    }
  }
  return totals;
}

export function dispatchStateMatches(state: CalendarDispatchState, filters: readonly string[]): boolean {
  return filters.length === 0 || filters.includes(state);
}

export type BoardReassignmentTarget = { employeeRecordId: string | null; userId: string | null; date: string };

/**
 * The one place that turns "this card, from that row, onto this cell" into
 * the fields to write: the drop and the popover's „Verschieben" form share
 * it. Returns null when nothing changes. A card taken from the unassigned
 * row gains the person; one dropped there loses the source person; between
 * rows the source person is replaced, so a two-person visit keeps the other.
 */
export function reassignmentChanges(input: {
  job: CalendarJob;
  sourceEmployeeRecordId: string | null;
  sourceUserId: string | null;
  target: BoardReassignmentTarget;
}): { plannedDate?: string; assignedUserIds?: string[]; assignedEmployeeRecordIds?: string[] } | null {
  const { job, sourceEmployeeRecordId, sourceUserId, target } = input;
  const dateChanged = job.plannedDate !== target.date;
  const rowChanged = target.employeeRecordId !== sourceEmployeeRecordId;
  if (!dateChanged && !rowChanged) return null;
  const swap = <Id extends string>(ids: readonly Id[], source: Id | null, next: Id | null): Id[] => {
    if (next === null) return ids.filter((id) => id !== source);
    if (source === null) return ids.includes(next) ? [...ids] : [...ids, next];
    return ids.map((id) => (id === source ? next : id));
  };
  const recordIds = job.assignedEmployeeRecordIds ?? [];
  return {
    ...(dateChanged ? { plannedDate: target.date } : {}),
    ...(rowChanged
      ? {
          assignedUserIds: swap(job.assignedUserIds, sourceUserId, target.userId),
          ...(job.occurrenceId ? { assignedEmployeeRecordIds: swap(recordIds, sourceEmployeeRecordId, target.employeeRecordId) } : {}),
        }
      : {}),
  };
}
