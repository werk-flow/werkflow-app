import { afterEach, describe, expect, test } from 'bun:test';
import {
  formatBerlin,
  formatBerlinDateTime,
  formatBerlinTime,
  formatLocalCalendarDay,
  formatGermanDate,
  formatGermanDateRange,
  parseIsoLocalDate,
  toLocalDateString,
  toLocalTimeOfDay,
  type BerlinLabelStyle,
} from './utils';

// The component copies these helpers replaced on 2026-10-01, kept here as the
// reference: the home must render the same text for every input they handled.
const dayOptions = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
const replacedCopies = {
  formatDate: (value: string): string =>
    new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', dayOptions),
  formatBerlinDateTime: (value: string): string =>
    new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Berlin',
    }).format(new Date(value)),
  isoToLocalDate: (value: string): Date | undefined => {
    if (!value) return undefined;
    const [year, month, day] = value.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) return undefined;
    return new Date(year, month - 1, day);
  },
};

describe('formatGermanDate', () => {
  test('renders a calendar date like the replaced copies', () => {
    expect(formatGermanDate('2026-09-13')).toBe('13.09.2026');
    for (const date of ['2026-09-13', '2026-01-01', '2026-03-29', '2026-12-31']) {
      expect(formatGermanDate(date)).toBe(replacedCopies.formatDate(date));
    }
  });

  test("renders a timestamp's Berlin day", () => {
    expect(formatGermanDate('2026-09-13T08:15:00.000Z')).toBe('13.09.2026');
    expect(formatGermanDate('2026-09-12T23:30:00+00:00')).toBe('13.09.2026');
  });

  test('renders the placeholder for a missing value only when one is given', () => {
    expect(formatGermanDate(null, { empty: '—' })).toBe('—');
    expect(formatGermanDate(undefined, { empty: '—' })).toBe('—');
    expect(formatGermanDate('', { empty: '—' })).toBe('—');
    expect(formatGermanDate('2026-09-13', { empty: '—' })).toBe('13.09.2026');
    expect(formatGermanDate('')).toBe('');
  });
});

describe('date-time formatters', () => {
  const timestamps = ['2026-09-13T08:15:00.000Z', '2026-09-13T00:00:00.000Z', '2026-03-29T01:30:00.000Z'];

  test('formatBerlinDateTime renders the Berlin wall clock', () => {
    expect(formatBerlinDateTime('2026-09-13T22:30:00.000Z')).toBe('14.09.2026, 00:30');
    for (const timestamp of timestamps) {
      expect(formatBerlinDateTime(timestamp)).toBe(replacedCopies.formatBerlinDateTime(timestamp));
    }
  });
});

// A server renders in UTC and a browser in any zone: the labels stay on Berlin's calendar and clock.
describe('date labels outside Berlin', () => {
  // Restore the zone itself: deleting TZ would leave the last zone in force for the later test files.
  const zoneBefore = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => {
    process.env.TZ = zoneBefore;
  });

  for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
    test(`renders Berlin's day and wall clock in ${zone}`, () => {
      process.env.TZ = zone;
      expect(new Date('2026-09-12T23:30:00.000Z').getTimezoneOffset()).not.toBe(-120);
      expect(formatGermanDate('2026-09-12T23:30:00.000Z')).toBe('13.09.2026');
      expect(formatGermanDate('2026-09-13')).toBe('13.09.2026');
      expect(formatBerlinDateTime('2026-09-12T23:30:00.000Z')).toBe('13.09.2026, 01:30');
      expect(formatBerlinTime('2026-03-29T01:30:00.000Z')).toBe('03:30');
    });
  }
});

describe('parseIsoLocalDate', () => {
  test('parses a calendar date as local midnight, like the replaced copies', () => {
    for (const value of ['2026-09-13', '2026-01-01', '2026-12-31']) {
      expect(parseIsoLocalDate(value)).toEqual(replacedCopies.isoToLocalDate(value));
    }
    expect(parseIsoLocalDate('2026-09-13')).toEqual(new Date(2026, 8, 13));
  });

  test('returns no date for an empty or incomplete value', () => {
    expect(parseIsoLocalDate('')).toBeUndefined();
    expect(parseIsoLocalDate('2026-09')).toBeUndefined();
    expect(parseIsoLocalDate('kein Datum')).toBeUndefined();
  });

  test('round-trips with toLocalDateString', () => {
    const date = parseIsoLocalDate('2026-09-13');
    expect(date).toBeDefined();
    if (date) expect(toLocalDateString(date)).toBe('2026-09-13');
    expect(toLocalDateString(new Date(202, 0, 1))).toBe('0202-01-01');
  });
});

describe('formatGermanDateRange', () => {
  test('renders one day once and several days as a range', () => {
    expect(formatGermanDateRange('2026-09-13', '2026-09-13')).toBe('13.09.2026');
    expect(formatGermanDateRange('2026-09-13', '2026-09-15')).toBe('13.09.2026 – 15.09.2026');
    expect(formatGermanDateRange('2026-12-30', '2027-01-02')).toBe('30.12.2026 – 02.01.2027');
  });
});

describe('formatBerlinTime', () => {
  test('renders the Berlin wall clock with two-digit hours and minutes', () => {
    expect(formatBerlinTime('2026-09-13T06:05:00.000Z')).toBe('08:05');
    expect(formatBerlinTime('2026-01-13T06:05:00.000Z')).toBe('07:05');
    expect(formatBerlinTime(new Date('2026-09-13T22:30:00.000Z'))).toBe('00:30');
  });

  test('keeps the Berlin hour across the daylight-saving switch', () => {
    expect(formatBerlinTime('2026-03-29T00:59:00.000Z')).toBe('01:59');
    expect(formatBerlinTime('2026-03-29T01:00:00.000Z')).toBe('03:00');
  });
});

describe('formatBerlin', () => {
  const instants = [
    '2026-09-03T08:15:00.000Z',
    '2026-09-03T22:30:00.000Z',
    '2026-03-29T00:59:00.000Z',
    '2026-03-29T01:00:00.000Z',
    '2026-10-25T00:30:00.000Z',
    '2026-12-31T23:30:00.000Z',
  ];
  // The inline copies the styles replaced on 2026-10-16, pinned to Berlin:
  // each style renders the same text for every instant.
  const replacedOptions: Record<BerlinLabelStyle, Intl.DateTimeFormatOptions> = {
    numericDate: {},
    date: { day: '2-digit', month: '2-digit', year: 'numeric' },
    shortYearDate: { day: '2-digit', month: '2-digit', year: '2-digit' },
    compactDate: { day: 'numeric', month: 'numeric', year: '2-digit' },
    longDate: { dateStyle: 'long' },
    weekdayDayMonth: { weekday: 'short', day: '2-digit', month: '2-digit' },
    weekdayDate: { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' },
    longWeekdayDate: { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' },
    monthYear: { month: 'long', year: 'numeric' },
    shortMonthYear: { month: 'short', year: 'numeric' },
    shortMonth: { month: 'short' },
    time: { hour: '2-digit', minute: '2-digit' },
    dayMonthTime: { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
    shortDateTime: { dateStyle: 'short', timeStyle: 'short' },
    dateTime: { dateStyle: 'medium', timeStyle: 'short' },
    weekdayDateTime: {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
    longWeekdayDateTime: {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  };

  test('every style renders the Berlin wall clock like the replaced copy', () => {
    const isStyle = (key: string): key is BerlinLabelStyle => key in replacedOptions;
    for (const style of Object.keys(replacedOptions).filter(isStyle)) {
      const reference = new Intl.DateTimeFormat('de-DE', {
        ...replacedOptions[style],
        timeZone: 'Europe/Berlin',
      });
      for (const instant of instants) {
        expect(formatBerlin(instant, style), `${style} ${instant}`).toBe(reference.format(new Date(instant)));
        expect(formatBerlin(new Date(instant), style)).toBe(reference.format(new Date(instant)));
      }
    }
  });

  test('renders the sample text of each style', () => {
    const instant = '2026-09-03T08:15:00.000Z';
    expect(formatBerlin(instant, 'numericDate')).toBe('3.9.2026');
    expect(formatBerlin(instant, 'date')).toBe('03.09.2026');
    expect(formatBerlin(instant, 'shortYearDate')).toBe('03.09.26');
    expect(formatBerlin(instant, 'longDate')).toBe('3. September 2026');
    expect(formatBerlin(instant, 'weekdayDate')).toBe('Do., 03.09.2026');
    expect(formatBerlin(instant, 'longWeekdayDateTime')).toBe('Donnerstag, 03.09.2026, 10:15');
    expect(formatBerlin(instant, 'dayMonthTime')).toBe('03.09., 10:15');
  });

  test('a calendar date renders as that date, like the noon and local-midnight copies', () => {
    for (const date of ['2026-01-01', '2026-03-29', '2026-09-03', '2026-10-25', '2026-12-31']) {
      expect(formatBerlin(date, 'numericDate')).toBe(
        new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' }).format(new Date(`${date}T12:00:00Z`)),
      );
      expect(formatBerlin(date, 'date')).toBe(formatGermanDate(date));
      expect(formatBerlin(date, 'monthYear')).toBe(
        new Intl.DateTimeFormat('de-DE', {
          month: 'long',
          year: 'numeric',
          timeZone: 'Europe/Berlin',
        }).format(new Date(`${date}T12:00:00.000Z`)),
      );
    }
  });

  test('a local calendar day keeps its own day', () => {
    const localMidnight = new Date(2026, 8, 3);
    expect(formatLocalCalendarDay(localMidnight, 'compactDate')).toBe(
      localMidnight.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', year: '2-digit' }),
    );
    expect(formatLocalCalendarDay(localMidnight, 'shortMonthYear')).toBe('Sept. 2026');
    expect(formatLocalCalendarDay(new Date(2026, 8, 3, 23, 59), 'numericDate')).toBe('3.9.2026');
  });
});

describe('toLocalTimeOfDay', () => {
  test("renders the Date's local hours and minutes as a time input value", () => {
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 8, 5))).toBe('08:05');
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 0, 0))).toBe('00:00');
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 23, 59, 59))).toBe('23:59');
  });
});
