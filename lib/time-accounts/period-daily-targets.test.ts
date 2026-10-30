import { describe, expect, mock, test } from 'bun:test';

import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';

mock.module('server-only', () => ({}));
const { resolveEmployeeDailyTargets } = await import('./period-preparation');

// werk-flow/werkflow-planning#79: the October period counted Friday 30.10.
// for a person who left on 29.10., so the closing Zeitkonto balance carried a
// target for a day after the exit.

const scheduleRow = {
  id: 'schedule-1',
  organization_id: 'org-1',
  employee_record_id: 'record-1',
  valid_from: '2026-01-01',
  monday_minutes: 360,
  tuesday_minutes: 360,
  wednesday_minutes: 360,
  thursday_minutes: 360,
  friday_minutes: 360,
  saturday_minutes: 0,
  sunday_minutes: 0,
  note: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function periodTargets(exitDate: string | null) {
  return resolveEmployeeDailyTargets({ id: 'record-1', entry_date: null, exit_date: exitDate }, new Map(), {
    sources: {
      schedules: [scheduleRow],
      conditions: [],
      vacations: new Map(),
      sickness: new Map(),
      calendar: EMPTY_HOLIDAY_CALENDAR,
    },
    // Thursday 29.10. and Friday 30.10.2026.
    index: { dates: ['2026-10-29', '2026-10-30'] },
  });
}

describe('the period daily targets', () => {
  test('end at the exit date', () => {
    const { dailyTargets } = periodTargets('2026-10-29');
    expect(dailyTargets.map((day) => [day.localDate, day.targetMinutes])).toEqual([
      ['2026-10-29', 360],
      ['2026-10-30', 0],
    ]);
  });

  test('run through the period without an exit date', () => {
    const { dailyTargets } = periodTargets(null);
    expect(dailyTargets.map((day) => day.targetMinutes)).toEqual([360, 360]);
  });
});
