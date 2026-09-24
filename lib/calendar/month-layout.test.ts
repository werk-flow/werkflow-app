import { describe, expect, test } from 'bun:test';
import { monthGridRange, monthRowTemplate, monthWeeks } from './month-layout';

describe('month layout', () => {
  test('the week row template never uses repeat(0)', () => {
    expect(monthRowTemplate(0)).toBe('auto minmax(64px, auto)');
    expect(monthRowTemplate(2)).toBe('auto minmax(22px, auto) minmax(22px, auto) minmax(64px, auto)');
    expect(monthRowTemplate(-1)).not.toContain('repeat');
  });

  test('September 2026 spans five Monday-to-Sunday weeks with today, past and out-of-month marks', () => {
    const weeks = monthWeeks('2026-09-18', '2026-09-18');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.map((cell) => cell.date)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
    expect(weeks[2]?.[4]).toMatchObject({ date: '2026-09-18', isToday: true, isPast: false, inMonth: true });
    expect(weeks[2]?.[3]?.isPast).toBe(true);
    expect(weeks[4]?.[6]?.date).toBe('2026-10-04');
    expect(monthGridRange(weeks)).toEqual({ from: '2026-08-31', to: '2026-10-04' });
  });

  test('a month that starts on a Monday has no leading padding and still ends on a Sunday', () => {
    const weeks = monthWeeks('2026-06-10', '2026-09-18');
    expect(weeks[0]?.[0]?.date).toBe('2026-06-01');
    expect(weeks.at(-1)?.[6]?.date).toBe('2026-07-05');
    expect(weeks).toHaveLength(5);
  });
});
