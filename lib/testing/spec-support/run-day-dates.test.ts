import { describe, expect, test } from 'bun:test';
import { monthGridRange, monthWeeks } from '../../calendar/month-layout';
import { addLocalDays } from '../../date-time/berlin';
import { businessYearOffset, monthDragOffsets } from './run-day-dates';

const FIRST_RUN_DAY = '2026-01-01';
const LAST_RUN_DAY = '2037-12-31';

/** Every run day of twelve years, leap years and every month-end weekday included. */
function everyRunDay(): string[] {
  const days: string[] = [];
  for (let day = FIRST_RUN_DAY; day <= LAST_RUN_DAY; day = addLocalDays(day, 1)) days.push(day);
  return days;
}

describe('monthDragOffsets', () => {
  test('keeps the pair on an ordinary run day', () => {
    expect(monthDragOffsets('2026-11-05', 43)).toEqual([43, 44]);
  });

  test('moves back when the source is a month end on a Sunday', () => {
    // 2026-12-19 + 43 is Sunday 2027-01-31; the January grid ends there.
    expect(monthDragOffsets('2026-12-19', 43)).toEqual([42, 43]);
  });

  test('shows both days in the month of the source on every run day', () => {
    const hidden = everyRunDay().filter((businessDate) => {
      const [source, target] = monthDragOffsets(businessDate, 43).map((offset) =>
        addLocalDays(businessDate, offset),
      );
      if (!source || !target) return true;
      const shown = monthGridRange(monthWeeks(source, businessDate));
      return target !== addLocalDays(source, 1) || target > shown.to;
    });
    expect(hidden).toEqual([]);
  });
});

describe('businessYearOffset', () => {
  test('keeps a window that ends inside the year', () => {
    expect(businessYearOffset('2026-11-05', 38, 39)).toBe(38);
    expect(businessYearOffset('2026-11-22', 39, 39)).toBe(39);
  });

  test('moves the whole window once its end reaches the next year', () => {
    expect(businessYearOffset('2026-11-23', 35, 39)).toBe(-45);
    expect(businessYearOffset('2026-11-23', 39, 39)).toBe(-41);
  });

  test('keeps every date of the window in the business year and in order on every run day', () => {
    const broken = everyRunDay().filter((businessDate) => {
      const dates = [35, 37, 38, 39].map((offset) =>
        addLocalDays(businessDate, businessYearOffset(businessDate, offset, 39)),
      );
      const ordered = dates.every((date, index) => index === 0 || (dates[index - 1] ?? '') < date);
      return !ordered || dates.some((date) => date.slice(0, 4) !== businessDate.slice(0, 4));
    });
    expect(broken).toEqual([]);
  });
});
