import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { OrgRole } from '@/lib/jobs/types';
import { addLocalDays, splitTimedIntervalByBerlinDate } from '@/lib/planning/date-time';

/**
 * The board context (P1-24a): what the calendar needs beyond the window's
 * occurrences and time to draw people rows. It is the sixth dataset of the
 * range owner and arrives through `GET /api/calendar-board` for the same
 * window as the calendar GET. Planned minutes are not part of it: the client
 * derives them from the occurrences it already holds, so a drop moves the
 * capacity of a cell in the same frame as the card.
 */

export type CalendarBoardRow = {
  employeeRecordId: string;
  userId: string | null;
  displayName: string;
  role: OrgRole | null;
  /** Linked to a current membership; a person without one cannot acknowledge. */
  hasLogin: boolean;
  teamId: string | null;
  teamName: string | null;
  entryDate: string | null;
  exitDate: string | null;
};

type CalendarBoardAbsence = {
  type: 'vacation' | 'sickness';
  portion: 'full' | 'half_day';
};

/** One person-day from the planning owner's target resolution. */
export type CalendarBoardDay = {
  employeeRecordId: string;
  /** Berlin date, YYYY-MM-DD. */
  date: string;
  /** Effective target after holiday, closure and absence zeroing. */
  targetMinutes: number;
  /** Schedule target before zeroing; 0 on a non-working weekday. */
  baseTargetMinutes: number;
  reason: 'working' | 'no_work_day' | 'holiday' | 'closure';
  /** Holiday name or closure label when `reason` says so. */
  label: string | null;
  absence: CalendarBoardAbsence | null;
  /** A pending vacation request covers the day (provisional, warns only). */
  pendingVacation: boolean;
};

export type CalendarDispatchState = 'nicht_gesendet' | DispatchRecipientDerivedState;

export const CALENDAR_DISPATCH_STATE_LABELS: Record<CalendarDispatchState, string> = {
  nicht_gesendet: 'nicht gesendet',
  ausstehend: 'gesendet',
  bestaetigt: 'bestätigt',
  uebernommen: 'übernommen',
  rueckfrage: 'Rückfrage',
  nicht_moeglich: 'ohne Zugang',
};

export type CalendarBoardDispatch = {
  occurrenceId: string;
  employeeRecordId: string;
  state: DispatchRecipientDerivedState;
};

export type CalendarBoardContext = {
  rows: CalendarBoardRow[];
  days: CalendarBoardDay[];
  dispatch: CalendarBoardDispatch[];
  /** Jobs with at least one planned material line (readiness chip: „nicht reserviert"). */
  materialDemandJobIds: string[];
};

export const EMPTY_CALENDAR_BOARD: CalendarBoardContext = {
  rows: [],
  days: [],
  dispatch: [],
  materialDemandJobIds: [],
};

export function boardDayKey(employeeRecordId: string, date: string): string {
  return `${employeeRecordId}:${date}`;
}

export function indexBoardDays(days: readonly CalendarBoardDay[]): Map<string, CalendarBoardDay> {
  return new Map(days.map((day) => [boardDayKey(day.employeeRecordId, day.date), day]));
}

export function indexBoardDispatch(
  dispatch: readonly CalendarBoardDispatch[],
): Map<string, DispatchRecipientDerivedState> {
  return new Map(dispatch.map((entry) => [`${entry.occurrenceId}:${entry.employeeRecordId}`, entry.state]));
}

export function dispatchStateFor(
  index: ReadonlyMap<string, DispatchRecipientDerivedState>,
  occurrenceId: string | undefined,
  employeeRecordId: string | null,
): CalendarDispatchState {
  if (!occurrenceId || !employeeRecordId) return 'nicht_gesendet';
  return index.get(`${occurrenceId}:${employeeRecordId}`) ?? 'nicht_gesendet';
}

/**
 * Planned minutes per person and Berlin date, the way the P1-11 assessment
 * counts them: timed occurrences by their allocation per date, all-day
 * occurrences by the day's target. Skipped and cancelled occurrences do not
 * count, a note (an all-day internal „Sonstiges" entry) carries no capacity,
 * and a job without an occurrence (legacy bridge without a time) counts its
 * estimated duration on its planned date; such a job carries user ids only,
 * which `recordIdByUserId` resolves to the person's record.
 */
/** A note: an all-day internal „Sonstiges" entry, shown as its own card without dispatch or capacity. */
export function isNoteEntry(job: Pick<CalendarJob, 'entryKind' | 'internalType' | 'timeKind'>): boolean {
  return job.entryKind === 'internal' && job.internalType === 'other' && job.timeKind === 'all_day';
}

export function plannedMinutesByEmployeeDate(
  jobs: readonly CalendarJob[],
  targetMinutes: (employeeRecordId: string, date: string) => number,
  recordIdByUserId: ReadonlyMap<string, string> = new Map(),
): Map<string, number> {
  const minutes = new Map<string, number>();
  const add = (employeeRecordId: string, date: string, value: number): void => {
    const key = boardDayKey(employeeRecordId, date);
    minutes.set(key, (minutes.get(key) ?? 0) + value);
  };
  for (const job of jobs) {
    if (job.occurrenceStatus === 'skipped' || job.occurrenceStatus === 'cancelled' || isNoteEntry(job)) continue;
    const records = job.assignedEmployeeRecordIds ?? job.assignedUserIds.flatMap((userId) => recordIdByUserId.get(userId) ?? []);
    if (records.length === 0) continue;
    if (job.startAt && job.endAt) {
      for (const allocation of splitTimedIntervalByBerlinDate(new Date(job.startAt), new Date(job.endAt))) {
        for (const record of records) add(record, allocation.localDate, allocation.minutes);
      }
      continue;
    }
    if (!job.plannedDate) continue;
    const end = job.endDateExclusive ?? addLocalDays(job.plannedDate, 1);
    if (job.timeKind === 'all_day' || !job.plannedTime) {
      for (let date = job.plannedDate; date < end; date = addLocalDays(date, 1)) {
        for (const record of records) add(record, date, targetMinutes(record, date));
      }
      continue;
    }
    for (const record of records) add(record, job.plannedDate, job.estimatedDurationMinutes ?? 0);
  }
  return minutes;
}

export type CapacityState = 'off' | 'free' | 'partial' | 'full' | 'overbooked';

/** Fifteen minutes of slack keep a full day from reading as overbooked. */
const FULL_TOLERANCE_MINUTES = 15;

export function deriveCapacityState(day: CalendarBoardDay, plannedMinutes: number): CapacityState {
  if (plannedMinutes <= 0) return day.targetMinutes === 0 ? 'off' : 'free';
  if (day.targetMinutes === 0) return 'overbooked';
  if (plannedMinutes > day.targetMinutes + FULL_TOLERANCE_MINUTES) return 'overbooked';
  if (plannedMinutes >= day.targetMinutes - FULL_TOLERANCE_MINUTES) return 'full';
  return 'partial';
}

const CAPACITY_STATE_LABELS: Record<CapacityState, string> = {
  off: 'kein Arbeitstag',
  free: 'frei',
  partial: 'teilweise geplant',
  full: 'voll',
  overbooked: 'überbucht',
};

export function formatShortHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;
}

/** The sentence behind a capacity cell, for hover and for assistive technology. */
export function describeCapacity(day: CalendarBoardDay, plannedMinutes: number): string {
  const state = deriveCapacityState(day, plannedMinutes);
  if (state === 'off') {
    if (day.reason === 'holiday') return `Feiertag${day.label ? `: ${day.label}` : ''}`;
    if (day.reason === 'closure') return `Betriebsruhe${day.label ? `: ${day.label}` : ''}`;
    if (day.absence) return day.absence.type === 'vacation' ? 'Urlaub' : 'Abwesend';
    return 'Kein Arbeitstag';
  }
  const planned = formatShortHours(plannedMinutes);
  const target = formatShortHours(day.targetMinutes);
  const suffix = day.pendingVacation ? ', Urlaub angefragt' : '';
  return `${CAPACITY_STATE_LABELS[state]}: ${planned} von ${target} geplant${suffix}`;
}
