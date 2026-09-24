import { describe, expect, test } from 'bun:test';
import type { CalendarBoardDay, CalendarBoardRow } from './board';
import { checkNotAlreadyAssigned, checkParkable, checkPersonDay, checkReadOnly, checkTimeBlockTarget } from './refusal-checks';

const row: CalendarBoardRow = { employeeRecordId: 'r1', userId: 'u1', displayName: 'Sven Neumann', role: 'employee', hasLogin: true, teamId: null, teamName: null, entryDate: '2020-01-01', exitDate: '2026-09-30' };
const day = (overrides: Partial<CalendarBoardDay>): CalendarBoardDay => ({ employeeRecordId: 'r1', date: '2026-09-18', targetMinutes: 480, baseTargetMinutes: 480, reason: 'working', label: null, absence: null, pendingVacation: false, ...overrides });

describe('client pre-checks', () => {
  test('name the person and the date in absence, off-day and employment refusals; Shift allows warnings', () => {
    expect(checkPersonDay({ row, day: day({ absence: { type: 'vacation', portion: 'full' }, targetMinutes: 0 }), date: '2026-09-18', allowWarnings: false })).toMatchObject({ ok: false, code: 'person_absent', message: 'Sven Neumann ist am 18.9. abwesend. Wähle einen anderen Tag oder eine andere Person.' });
    expect(checkPersonDay({ row, day: day({ reason: 'no_work_day', targetMinutes: 0, baseTargetMinutes: 0 }), date: '2026-09-19', allowWarnings: false })).toMatchObject({ ok: false, code: 'person_off_day' });
    expect(checkPersonDay({ row, day: day({ reason: 'no_work_day', targetMinutes: 0, baseTargetMinutes: 0 }), date: '2026-09-19', allowWarnings: true })).toEqual({ ok: true });
    expect(checkPersonDay({ row, day: day({}), date: '2026-10-01', allowWarnings: true })).toMatchObject({ ok: false, code: 'person_not_employed' });
    expect(checkPersonDay({ row, day: day({ absence: { type: 'vacation', portion: 'half_day' }, targetMinutes: 240 }), date: '2026-09-18', allowWarnings: false })).toEqual({ ok: true });
    expect(checkPersonDay({ row: null, day: undefined, date: '2026-09-18', allowWarnings: false })).toEqual({ ok: true });
  });

  test('read-only, parkability, double assignment and time rules', () => {
    expect(checkReadOnly(true)).toMatchObject({ ok: false, code: 'read_only_mode' });
    expect(checkParkable({ entryKind: 'internal', jobId: null, occurrenceId: 'o', id: 'o' })).toMatchObject({ ok: false, code: 'internal_not_parkable' });
    expect(checkParkable({ entryKind: 'job_visit', jobId: 'j', occurrenceId: 'o', id: 'o' })).toEqual({ ok: true });
    expect(checkNotAlreadyAssigned({ assignedEmployeeRecordIds: ['r1', 'r2'] }, 'r2', 'r1', 'Mia')).toMatchObject({ ok: false, code: 'target_already_assigned', message: 'Mia ist diesem Termin bereits zugewiesen.' });
    expect(checkNotAlreadyAssigned({ assignedEmployeeRecordIds: ['r1'] }, 'r1', 'r1', 'Mia')).toEqual({ ok: true });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 15, targetName: null, otherBlocks: [] })).toMatchObject({ ok: false, code: 'future_timestamp' });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 30, targetName: 'Mia', otherBlocks: [{ startMs: 15, endMs: 25 }] })).toMatchObject({ ok: false, code: 'overlapping_time_block' });
    expect(checkTimeBlockTarget({ startMs: 10, endMs: 20, nowMs: 30, targetName: 'Mia', otherBlocks: [{ startMs: 20, endMs: 25 }] })).toEqual({ ok: true });
  });
});
