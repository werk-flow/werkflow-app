import { beforeAll, expect, test } from 'bun:test';

import { getBerlinDayFetchRange, getBerlinMonthFetchRange, getBerlinWeekFetchRange } from './business-range';
import { calendarAnchorDate, getCalendarFetchRange, rangesEqual } from './navigation';

beforeAll(() => {
  process.env.TZ = 'Europe/Berlin';
});

test('the server day window equals the browser day window for a Berlin user', () => {
  for (const date of ['2026-09-08', '2026-03-29', '2026-10-25', '2026-01-01', '2028-02-29']) {
    const [year, month, day] = date.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined)
      throw new Error(`Invalid test date: ${date}`);
    const browser = getCalendarFetchRange(new Date(year, month - 1, day, 9), 'day');
    expect(rangesEqual(getBerlinDayFetchRange(date), browser)).toBe(true);
  }
});

test('the window is expressed in absolute instants, independent of the process timezone', () => {
  const range = getBerlinDayFetchRange('2026-09-08');
  expect(range.start.toISOString()).toBe('2026-09-06T22:00:00.000Z');
  expect(range.end.toISOString()).toBe('2026-09-08T21:59:59.999Z');
  expect(() => getBerlinDayFetchRange('2026-13-40')).toThrow();
});

test('the month landing data covers the full client grid across DST and year boundaries', () => {
  for (const date of ['2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) {
    const [year, month, day] = date.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) throw new Error('Invalid fixture');
    expect(
      rangesEqual(
        getBerlinMonthFetchRange(date),
        getCalendarFetchRange(new Date(year, month - 1, day, 9), 'month'),
      ),
    ).toBe(true);
  }
});

test('the landing prefetch covers the first client window of every view, so a Berlin user reads nothing on open', () => {
  // The page reads the Berlin window for `initialDate`; the client anchors the
  // same date at local noon and derives its window. Equal ranges mean the
  // seeded coverage answers the first range effect without a second read.
  for (const date of ['2026-09-08', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) {
    const anchor = calendarAnchorDate(date);
    expect(rangesEqual(getBerlinDayFetchRange(date), getCalendarFetchRange(anchor, 'day')), date).toBe(true);
    expect(rangesEqual(getBerlinMonthFetchRange(date), getCalendarFetchRange(anchor, 'month')), date).toBe(
      true,
    );
    for (const horizonWeeks of [1, 2, 4, 6]) {
      expect(
        rangesEqual(
          getBerlinWeekFetchRange(date, horizonWeeks),
          getCalendarFetchRange(anchor, 'week', horizonWeeks),
        ),
        `${date} ${horizonWeeks}`,
      ).toBe(true);
    }
  }
});
