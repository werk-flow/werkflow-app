import { describe, expect, test } from 'bun:test';
import {
  formatBerlinDateTime,
  formatBerlinTime,
  formatGermanDate,
  formatGermanDateRange,
  formatGermanDateTime,
  formatGermanMediumDateTime,
  parseIsoLocalDate,
  toLocalDateString,
  toLocalTimeOfDay,
} from './utils';

// The component copies these helpers replaced on 2026-10-01, kept here as the
// reference: the home must render the same text for every input they handled.
const dayOptions = { day: '2-digit', month: '2-digit', year: 'numeric' } as const;
const minuteOptions = { ...dayOptions, hour: '2-digit', minute: '2-digit' } as const;
const replacedCopies = {
  formatDate: (value: string): string =>
    new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', dayOptions),
  formatTimestampDate: (value: string): string => new Date(value).toLocaleDateString('de-DE', dayOptions),
  formatDateTime: (value: string): string => new Date(value).toLocaleString('de-DE', minuteOptions),
  formatBerlinDateTime: (value: string): string =>
    new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Berlin',
    }).format(new Date(value)),
  formatMediumDateTime: (value: string): string =>
    new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
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

  test('keeps local midnight on the same calendar day', () => {
    expect(formatGermanDate(new Date(2026, 0, 1, 0, 0))).toBe('01.01.2026');
    expect(formatGermanDate('2026-01-01')).toBe('01.01.2026');
  });

  test("renders a timestamp's local day like the replaced copies", () => {
    for (const timestamp of ['2026-09-13T08:15:00.000Z', '2026-09-12T23:30:00+00:00']) {
      expect(formatGermanDate(timestamp)).toBe(replacedCopies.formatTimestampDate(timestamp));
    }
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

  test('formatGermanDateTime matches the replaced toLocaleString copies', () => {
    for (const timestamp of timestamps) {
      expect(formatGermanDateTime(timestamp)).toBe(replacedCopies.formatDateTime(timestamp));
    }
    expect(formatGermanDateTime(new Date(2026, 8, 13, 0, 0))).toBe('13.09.2026, 00:00');
  });

  test('formatBerlinDateTime renders the Berlin wall clock', () => {
    expect(formatBerlinDateTime('2026-09-13T22:30:00.000Z')).toBe('14.09.2026, 00:30');
    for (const timestamp of timestamps) {
      expect(formatBerlinDateTime(timestamp)).toBe(replacedCopies.formatBerlinDateTime(timestamp));
    }
  });

  test('formatGermanMediumDateTime matches the replaced service copies', () => {
    for (const timestamp of timestamps) {
      expect(formatGermanMediumDateTime(timestamp)).toBe(replacedCopies.formatMediumDateTime(timestamp));
    }
  });
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

describe('toLocalTimeOfDay', () => {
  test("renders the Date's local hours and minutes as a time input value", () => {
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 8, 5))).toBe('08:05');
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 0, 0))).toBe('00:00');
    expect(toLocalTimeOfDay(new Date(2026, 8, 13, 23, 59, 59))).toBe('23:59');
  });
});
