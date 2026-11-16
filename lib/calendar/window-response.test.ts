import { describe, expect, test } from 'bun:test';
import { CALENDAR_ABSENCE_TYPES } from './board';
import { calendarBoardResponseSchema } from './window-response';

// The board GET carried a Berufsschule day (werk-flow/werkflow-planning#165)
// that its schema did not know, so the apprentice's calendar refused the
// whole board read and showed „Der Kalender konnte nicht aktualisiert werden“.

const day = (type: (typeof CALENDAR_ABSENCE_TYPES)[number]) => ({
  employeeRecordId: 'record-1',
  date: '2026-11-13',
  targetMinutes: 0,
  baseTargetMinutes: 480,
  reason: 'working',
  label: null,
  absence: { type, portion: 'full' },
  pendingVacation: false,
});

describe('the board response schema', () => {
  test.each([...CALENDAR_ABSENCE_TYPES])('accepts a capacity day with a %s absence', (type) => {
    const parsed = calendarBoardResponseSchema.safeParse({
      success: true,
      rows: [],
      days: [day(type)],
      dispatch: [],
      materialDemandJobIds: [],
      rowlessAssignees: [],
    });
    expect(parsed.success).toBe(true);
  });
});
