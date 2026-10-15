import { describe, expect, test } from 'bun:test';
import {
  closedPeriodsToHide,
  entryBusinessDate,
  isDateInClosedPeriod,
  isEntryInClosedPeriod,
} from './closed-period-dates';

const JUNE = { startDate: '2026-06-01', endDate: '2026-06-30' };

describe('isDateInClosedPeriod', () => {
  test('includes both boundary dates and nothing outside them', () => {
    expect(isDateInClosedPeriod('2026-06-01', [JUNE])).toBe(true);
    expect(isDateInClosedPeriod('2026-06-30', [JUNE])).toBe(true);
    expect(isDateInClosedPeriod('2026-05-31', [JUNE])).toBe(false);
    expect(isDateInClosedPeriod('2026-07-01', [JUNE])).toBe(false);
  });

  test('without closed periods every date is open', () => {
    expect(isDateInClosedPeriod('2026-06-15', [])).toBe(false);
  });
});

describe('closedPeriodsToHide', () => {
  test('a current read hides its periods; a missing or failed refresh hides nothing', () => {
    expect(closedPeriodsToHide([JUNE], false)).toEqual([JUNE]);
    expect(closedPeriodsToHide(undefined, false)).toEqual([]);
    // The live view keeps June after a failed refresh; June may have been reopened since.
    expect(isDateInClosedPeriod('2026-06-15', closedPeriodsToHide([JUNE], true))).toBe(false);
  });
});

describe('isEntryInClosedPeriod', () => {
  test('reads the Berlin date, not the UTC date', () => {
    // 2026-06-30T22:30Z is 00:30 on 1 July in Berlin; 2026-05-31T22:30Z is 00:30 on 1 June.
    const julyStart = { timestamp: '2026-06-30T22:30:00.000Z', entryType: 'clock_in' } as const;
    const juneStart = { timestamp: '2026-05-31T22:30:00.000Z', entryType: 'clock_in' } as const;
    expect(isEntryInClosedPeriod(julyStart, [JUNE])).toBe(false);
    expect(isEntryInClosedPeriod(juneStart, [JUNE])).toBe(true);
  });

  test('a closing entry at Berlin midnight belongs to the day before', () => {
    const midnightJuly = '2026-06-30T22:00:00.000Z';
    expect(entryBusinessDate({ timestamp: midnightJuly, entryType: 'clock_out' })).toBe('2026-06-30');
    expect(entryBusinessDate({ timestamp: midnightJuly, entryType: 'break_end' })).toBe('2026-06-30');
    expect(entryBusinessDate({ timestamp: midnightJuly, entryType: 'clock_in' })).toBe('2026-07-01');
    expect(isEntryInClosedPeriod({ timestamp: midnightJuly, entryType: 'clock_out' }, [JUNE])).toBe(true);
    expect(isEntryInClosedPeriod({ timestamp: midnightJuly, entryType: 'clock_in' }, [JUNE])).toBe(false);
  });
});
