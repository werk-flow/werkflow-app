// Rule test: a visual reference of a week that moves with the run day reads the same on every run day.
import { expect, test } from 'bun:test';
import { formatCompactCalendarRange } from '../../calendar/header-labels';
import { shiftIsoDateByDays } from '../../personnel/types';
import { weekLabel } from '../../weekly-numbers/format';
import { standInPatterns } from '../../../tests/audit/support/visual-references';

// The calendar references show the week that `ownedBerlinWeekAtOffset` gives
// the run day (tests/audit/support/visual-families.ts), so its labels move
// with the run day. The stand-ins replace a whole range before the clock
// patterns see its parts: a week inside one month, across two months, across
// the year end and a horizon of two weeks all read alike.

function standIn(text: string, calendarWeek: boolean): string {
  let next = text;
  for (const [source, replacement] of standInPatterns(calendarWeek))
    next = next.replace(new RegExp(source, 'g'), replacement);
  return next;
}

test('the week label of the calendar header reads alike for every week', () => {
  const labels = [
    '6. - 12. April 2027 · KW 14',
    '30. März - 5. April 2026 · KW 14',
    '28. Dezember - 3. Januar 2027 · KW 53',
    '6. - 19. April 2027 · KW 14–15',
  ];
  expect(labels.map((label) => standIn(label, true))).toEqual(labels.map(() => '1. - 1. Januar 2026 · KW 1'));
});

test('the compact week range of the phone header reads alike for every Monday of a year', () => {
  const ranges = new Set<string>();
  for (let week = 0; week < 53; week += 1) {
    const monday = new Date(2026, 9, 26 + week * 7);
    const sunday = new Date(2026, 9, 26 + week * 7 + 6);
    ranges.add(standIn(formatCompactCalendarRange(monday, sunday), true));
  }
  expect([...ranges]).toEqual(['01.01. – 01.01.26']);
});

test('probe: without the week patterns the clock text splits a range, so the stand-in moves with the run day', () => {
  expect(standIn('6. - 12. April 2027', false)).toBe('6. - 1. Januar 2026');
  expect(standIn('30. März - 5. April 2026', false)).toBe('1. Januar - 1. Januar 2026');
  // The stand-ins are fixed points: the clock patterns that run after them leave them unchanged.
  expect(standIn('1. - 1. Januar 2026 · KW 1', false)).toBe('1. - 1. Januar 2026 · KW 1');
});

// The Wochenzahlen (`/kennzahlen`) show the last 12 weeks before the run day,
// so their labels move every week too. Their format („KW 9“, „23.02.–01.03.“)
// is no calendar range: the clock patterns alone replace each part, so the
// family needs no calendar-week stand-ins (tests/audit/support/visual-families.ts).
test('the week labels of the Wochenzahlen read alike for every week and every day of the running week', () => {
  const shown = new Set<string>();
  // Two years of Mondays: the year end with a week 53 (28.12.2026), a month end and the leap day 2028-02-29.
  for (let week = 0; week < 106; week += 1) {
    const weekStart = shiftIsoDateByDays('2026-01-05', week * 7);
    for (let day = 0; day < 7; day += 1) {
      const { title, range } = weekLabel({ weekStart, lastDay: shiftIsoDateByDays(weekStart, day) });
      // The text nodes the desktop table and the phone cards render.
      for (const text of [title, range, `${range} bis jetzt`, `· ${range}`]) shown.add(standIn(text, false));
    }
  }
  expect([...shown].toSorted()).toEqual([
    '01.01.–01.01.',
    '01.01.–01.01. bis jetzt',
    'KW 1',
    '· 01.01.–01.01.',
  ]);
});
