import { describe, expect, test } from 'bun:test';
import type { CalendarBoardDay, CalendarBoardRow } from './board';
import { checkNotAlreadyAssigned, checkOccurrenceMovable, checkParkable, checkPersonDay, checkTimeBlockTarget } from './refusal-checks';
import { isStartedOccurrence } from './board';

const row: CalendarBoardRow = { employeeRecordId: 'r1', userId: 'u1', displayName: 'Sven Neumann', role: 'employee', hasLogin: true, teamId: null, teamName: null, entryDate: '2020-01-01', exitDate: '2026-09-30' };
const day = (overrides: Partial<CalendarBoardDay>): CalendarBoardDay => ({ employeeRecordId: 'r1', date: '2026-09-18', targetMinutes: 480, baseTargetMinutes: 480, reason: 'working', label: null, absence: null, pendingVacation: false, ...overrides });

describe('client pre-checks', () => {
  test('a started or past occurrence is history: the database rule, judged before any drag or edit', () => {
    const now = Date.parse('2026-09-25T10:00:00.000Z'); // 12:00 in Berlin
    const timed = { occurrenceId: 'o1', timeKind: 'timed' as const, startAt: '2026-09-25T09:00:00.000Z', plannedDate: '2026-09-25', plannedTime: '11:00' };
    expect(isStartedOccurrence(timed, now)).toBe(true);
    expect(isStartedOccurrence({ ...timed, startAt: '2026-09-25T10:30:00.000Z', plannedTime: '12:30' }, now)).toBe(false);
    // Without the instant the Berlin wall time decides; an all-day occurrence from its date.
    expect(isStartedOccurrence({ ...timed, startAt: null, plannedTime: '11:00' }, now)).toBe(true);
    expect(isStartedOccurrence({ ...timed, startAt: null, plannedTime: '12:30' }, now)).toBe(false);
    expect(isStartedOccurrence({ occurrenceId: 'o2', timeKind: 'all_day' as const, startAt: null, plannedDate: '2026-09-25', plannedTime: null }, now)).toBe(true);
    expect(isStartedOccurrence({ occurrenceId: 'o2', timeKind: 'all_day' as const, startAt: null, plannedDate: '2026-09-26', plannedTime: null }, now)).toBe(false);
    // A legacy job without an occurrence is not under the rule.
    expect(isStartedOccurrence({ occurrenceId: undefined, timeKind: undefined, startAt: null, plannedDate: '2026-09-01', plannedTime: '08:00' }, now)).toBe(false);
    expect(checkOccurrenceMovable({ ...timed, occurrenceStatus: 'scheduled' }, now)).toMatchObject({ ok: false, code: 'started_occurrence' });
    expect(checkOccurrenceMovable({ ...timed, occurrenceStatus: 'cancelled' }, now)).toMatchObject({ ok: false, code: 'inactive_occurrence' });
  });

  test('name the person and the date in absence, off-day and employment refusals; Shift allows warnings', () => {
    expect(checkPersonDay({ row, day: day({ absence: { type: 'vacation', portion: 'full' }, targetMinutes: 0 }), date: '2026-09-18', allowWarnings: false })).toMatchObject({ ok: false, code: 'person_absent', message: 'Sven Neumann ist am 18.9. abwesend. Wähle einen anderen Tag oder eine andere Person.' });
    expect(checkPersonDay({ row, day: day({ reason: 'no_work_day', targetMinutes: 0, baseTargetMinutes: 0 }), date: '2026-09-19', allowWarnings: false })).toMatchObject({ ok: false, code: 'person_off_day' });
    expect(checkPersonDay({ row, day: day({ reason: 'no_work_day', targetMinutes: 0, baseTargetMinutes: 0 }), date: '2026-09-19', allowWarnings: true })).toEqual({ ok: true });
    expect(checkPersonDay({ row, day: day({}), date: '2026-10-01', allowWarnings: true })).toMatchObject({ ok: false, code: 'person_not_employed' });
    expect(checkPersonDay({ row, day: day({ absence: { type: 'vacation', portion: 'half_day' }, targetMinutes: 240 }), date: '2026-09-18', allowWarnings: false })).toEqual({ ok: true });
    expect(checkPersonDay({ row: null, day: undefined, date: '2026-09-18', allowWarnings: false })).toEqual({ ok: true });
  });

  test('read-only, parkability, double assignment and time rules', () => {
    expect(checkParkable({ entryKind: 'internal', jobId: null, occurrenceId: 'o', id: 'o' })).toMatchObject({ ok: false, code: 'internal_not_parkable' });
    expect(checkParkable({ entryKind: 'job_visit', jobId: 'j', occurrenceId: 'o', id: 'o' })).toEqual({ ok: true });
    expect(checkNotAlreadyAssigned({ assignedEmployeeRecordIds: ['r1', 'r2'] }, 'r2', 'r1', 'Mia')).toMatchObject({ ok: false, code: 'target_already_assigned', message: 'Mia ist diesem Termin bereits zugewiesen.' });
    expect(checkNotAlreadyAssigned({ assignedEmployeeRecordIds: ['r1'] }, 'r1', 'r1', 'Mia')).toEqual({ ok: true });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 15, targetName: null, otherBlocks: [] })).toMatchObject({ ok: false, code: 'future_timestamp' });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 30, targetName: 'Mia', otherBlocks: [{ startMs: 15, endMs: 25 }] })).toMatchObject({ ok: false, code: 'overlapping_time_block' });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 30, targetName: 'Mia', otherBlocks: [{ startMs: 20, endMs: 25 }] })).toEqual({ ok: true });
  });
});
