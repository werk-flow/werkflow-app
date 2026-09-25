import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_CALENDAR_PREFERENCES,
  readCalendarPreferences,
  resolveShowActualTime,
  writeCalendarPreferencesJson,
} from './preferences';

describe('calendar preferences', () => {
  test('reads defaults for missing, damaged and foreign JSON', () => {
    expect(readCalendarPreferences(null)).toEqual(DEFAULT_CALENDAR_PREFERENCES);
    expect(readCalendarPreferences('nonsense')).toEqual(DEFAULT_CALENDAR_PREFERENCES);
    expect(readCalendarPreferences({ auftraege: { visibleColumns: ['title'] } })).toEqual(DEFAULT_CALENDAR_PREFERENCES);
  });

  test('keeps valid fields and replaces invalid ones field by field', () => {
    const preferences = readCalendarPreferences({
      calendar: { horizonWeeks: 6, density: 'loud', hideWeekends: true, search: 'Heizung', dispatchStates: ['rueckfrage', 'bogus'], view: 'week' },
    });
    expect(preferences).toEqual({
      ...DEFAULT_CALENDAR_PREFERENCES,
      horizonWeeks: 6,
      hideWeekends: true,
      search: 'Heizung',
      view: 'week',
    });
  });

  test('writes beside other preference keys without touching them', () => {
    const json = writeCalendarPreferencesJson({ auftraege: { visibleColumns: ['title'] } }, { ...DEFAULT_CALENDAR_PREFERENCES, hideWeekends: true });
    expect(json).toEqual({ auftraege: { visibleColumns: ['title'] }, calendar: { ...DEFAULT_CALENDAR_PREFERENCES, hideWeekends: true } });
    expect(readCalendarPreferences(json).hideWeekends).toBe(true);
  });

  test('actual time follows the horizon until the user chooses', () => {
    expect(resolveShowActualTime({ showActualTime: null, horizonWeeks: 1 })).toBe(true);
    expect(resolveShowActualTime({ showActualTime: null, horizonWeeks: 2 })).toBe(false);
    expect(resolveShowActualTime({ showActualTime: true, horizonWeeks: 6 })).toBe(true);
  });
});
