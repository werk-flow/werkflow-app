import { describe, expect, test } from 'bun:test';
import { EMPTY_HOLIDAY_CALENDAR } from '@/lib/personnel/targets';
import type { VacationCountingContext } from './balance';
import { plannedVacationDays } from './planned';
import type { VacationRequest } from './types';

// No schedule: the labeled default counts Monday to Friday.
const context: VacationCountingContext = { schedules: [], conditions: [], calendar: EMPTY_HOLIDAY_CALENDAR };
// Wednesday.
const today = '2026-10-28';

function approved(
  id: string,
  startDate: string,
  endDate: string,
  approvedDays: number,
  status: VacationRequest['status'] = 'approved',
): VacationRequest {
  return {
    id,
    organizationId: 'org-1',
    employeeRecordId: 'record-1',
    requestedBy: 'user-1',
    startDate,
    endDate,
    dayPortion: 'full',
    status,
    comment: null,
    decidedBy: null,
    decidedAt: null,
    decisionComment: null,
    cancelledBy: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedDaysByYear: status === 'approved' ? { '2026': approvedDays } : null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

describe('planned vacation days', () => {
  test('approved vacation after today is planned, not taken', () => {
    expect(
      plannedVacationDays(2026, [approved('november', '2026-11-02', '2026-11-06', 5)], context, today),
    ).toBe(5);
  });

  test('approved vacation that already passed is taken', () => {
    expect(
      plannedVacationDays(2026, [approved('august', '2026-08-10', '2026-08-14', 5)], context, today),
    ).toBe(0);
  });

  test('a vacation running over today plans only the days after it; today counts as taken', () => {
    // Monday to Friday of this week: Thursday and Friday still lie ahead.
    expect(
      plannedVacationDays(2026, [approved('this-week', '2026-10-26', '2026-10-30', 5)], context, today),
    ).toBe(2);
  });

  test('a pending request is neither taken nor planned', () => {
    expect(
      plannedVacationDays(
        2026,
        [approved('pending', '2026-11-02', '2026-11-06', 0, 'pending')],
        context,
        today,
      ),
    ).toBe(0);
  });

  test('a running vacation spends its approval-time snapshot on the taken days first', () => {
    // Approved as 1 day although the range now counts more: Monday to Wednesday
    // already took it, so nothing of it is still planned.
    expect(
      plannedVacationDays(2026, [approved('snapshot', '2026-10-26', '2026-10-30', 1)], context, today),
    ).toBe(0);
    // Approved as 4 days: 3 are taken through today, 1 of the 2 days ahead stays planned.
    expect(
      plannedVacationDays(2026, [approved('snapshot', '2026-10-26', '2026-10-30', 4)], context, today),
    ).toBe(1);
  });
});
