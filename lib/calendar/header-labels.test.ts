import { expect, test } from 'bun:test';
import { formatCompactCalendarRange } from './header-labels';

test('compact ranges have fixed spacing across month and year boundaries', () => {
  expect(formatCompactCalendarRange(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe('28.9. – 4.10.26');
  expect(formatCompactCalendarRange(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe('28.12.26 – 3.1.27');
});
