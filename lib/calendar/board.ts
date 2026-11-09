import type { DispatchRecipientDerivedState } from '@/lib/dispatch/types';
import type { CalendarJob } from '@/lib/jobs/types';
import type { Unavailability } from '@/lib/planning/availability';
import type { OrgRole } from '@/lib/roles';
import {
  addLocalDays,
  formatBerlinLocalDate,
  resolveBerlinWallTime,
  splitTimedIntervalByBerlinDate,
} from '@/lib/date-time/berlin';

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
  /** The Berlin date from which the person's app access has ended; null while it goes on. */
  accessEndDate: string | null;
};

/**
 * A person a scheduled visit of the window names who has no row, because
 * they are employed outside the whole window. The board shows their visits
 * as missing a person and names them.
 */
export type CalendarBoardRowlessAssignee = Pick<
  CalendarBoardRow,
  'employeeRecordId' | 'userId' | 'displayName' | 'entryDate' | 'exitDate' | 'accessEndDate'
>;

type CalendarBoardAbsence = {
  type: 'vacation' | 'sickness';
  portion: 'full' | 'half_day';
};

/** An absence by its kind; a sickness reads „Abwesend“, so the board never names it. */
const ABSENCE_LABELS: Record<CalendarBoardAbsence['type'], string> = {
  vacation: 'Urlaub',
  sickness: 'Abwesend',
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
  /** For a manager: the assignees of the window's scheduled visits without a row. */
  rowlessAssignees: CalendarBoardRowlessAssignee[];
};

export const EMPTY_CALENDAR_BOARD: CalendarBoardContext = {
  rows: [],
  days: [],
  dispatch: [],
  materialDemandJobIds: [],
  rowlessAssignees: [],
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
/**
 * The P1-11 rule the database enforces as `started_planning_occurrence_immutable`: a timed occurrence is
 * history from its start instant, an all-day one from its Berlin date. The views ask before any drag or
 * edit, so the refusal is never a banner after the fact. A job without an occurrence (legacy bridge) is
 * not covered by that rule.
 */
export function isStartedOccurrence(
  job: Pick<CalendarJob, 'occurrenceId' | 'timeKind' | 'startAt' | 'plannedDate' | 'plannedTime'>,
  nowMs: number,
): boolean {
  if (!job.occurrenceId || !job.plannedDate) return false;
  if (job.startAt) return new Date(job.startAt).getTime() <= nowMs;
  if (job.timeKind === 'all_day' || !job.plannedTime)
    return job.plannedDate <= formatBerlinLocalDate(new Date(nowMs));
  const start = resolveBerlinWallTime(`${job.plannedDate}T${job.plannedTime.slice(0, 5)}`);
  return start ? start.instant.getTime() <= nowMs : false;
}

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
    if (job.occurrenceStatus === 'skipped' || job.occurrenceStatus === 'cancelled' || isNoteEntry(job))
      continue;
    const records =
      job.assignedEmployeeRecordIds ??
      job.assignedUserIds.flatMap((userId) => recordIdByUserId.get(userId) ?? []);
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
function describeCapacity(day: CalendarBoardDay, plannedMinutes: number): string {
  const state = deriveCapacityState(day, plannedMinutes);
  if (state === 'off') {
    if (day.reason === 'holiday') return `Feiertag${day.label ? `: ${day.label}` : ''}`;
    if (day.reason === 'closure') return `Betriebsruhe${day.label ? `: ${day.label}` : ''}`;
    if (day.absence) return ABSENCE_LABELS[day.absence.type];
    return 'Kein Arbeitstag';
  }
  const planned = formatShortHours(plannedMinutes);
  const target = formatShortHours(day.targetMinutes);
  const suffix = day.pendingVacation ? ', Urlaub angefragt' : '';
  return `${CAPACITY_STATE_LABELS[state]}: ${planned} von ${target} geplant${suffix}`;
}

/** What one person-day of the board says: its capacity, whether it is off, and the sentence behind it. */
export type BoardCellCapacity = { state: CapacityState; off: boolean; description: string };

/**
 * A person-day of the board. A day the person cannot be planned (before
 * entry, after exit, or with app access ended) is off; work planned on it is
 * overbooked, because nobody can do it. An all-day visit there has no planned
 * minutes (the day's target is zero), so the row's visits say whether work
 * is planned.
 */
export function boardCellCapacity(input: {
  day: CalendarBoardDay | undefined;
  plannedMinutes: number;
  /** One of the row's visits covers the day. */
  hasPlannedWork: boolean;
  unavailability: Unavailability | null;
  isWeekend: boolean;
}): BoardCellCapacity {
  const { day, plannedMinutes, unavailability, isWeekend } = input;
  if (unavailability) {
    const reason = unavailability === 'access_ended' ? 'App-Zugang beendet' : 'Nicht beschäftigt';
    if (plannedMinutes <= 0 && !input.hasPlannedWork) return { state: 'off', off: true, description: reason };
    const planned = plannedMinutes > 0 ? `${formatShortHours(plannedMinutes)} geplant` : 'eingeplant';
    return { state: 'overbooked', off: true, description: `${reason}, trotzdem ${planned}` };
  }
  if (!day) {
    return {
      state: plannedMinutes > 0 ? 'partial' : 'free',
      off: isWeekend,
      description: isWeekend ? 'Wochenende' : '',
    };
  }
  return {
    state: deriveCapacityState(day, plannedMinutes),
    off: day.targetMinutes === 0 && plannedMinutes === 0,
    description: describeCapacity(day, plannedMinutes),
  };
}

/**
 * Why a person is away on a capacity day, as the card and the pickers mark
 * them: an approved absence, half or whole, or a vacation request still open;
 * null when nothing of the kind is recorded.
 */
export function absenceMark(day: CalendarBoardDay | undefined): string | null {
  if (day?.absence) {
    const label = ABSENCE_LABELS[day.absence.type];
    return day.absence.portion === 'half_day' ? `${label} (halber Tag)` : label;
  }
  return day?.pendingVacation ? 'Urlaub angefragt' : null;
}
