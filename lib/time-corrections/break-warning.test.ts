import { describe, expect, test } from 'bun:test';

import { describeBreakShortfall, findBreakShortfall } from './break-warning';
import { newTimelineRow, resolveCorrectionTimeline, type CorrectionTimelineRow } from './timeline';

function shortfall(...values: Array<Partial<Omit<CorrectionTimelineRow, 'key'>>>) {
  const resolved = resolveCorrectionTimeline(
    '2026-10-26',
    values.map((value, index) => newTimelineRow(`row-${index}`, value)),
  );
  if (!resolved.valid) throw new Error(JSON.stringify(resolved.errors));
  return findBreakShortfall(resolved.segments);
}

describe('the ArbZG § 4 break warning of a forgotten day', () => {
  test('8.5 hours of work without a break miss the 30-minute step, and the warning says so', () => {
    const missing = shortfall({ start: '07:00', end: '15:30' });
    expect(missing).toEqual({
      kind: 'total',
      workAboveHours: 6,
      requiredBreakMinutes: 30,
      countedBreakMinutes: 0,
    });
    expect(missing && describeBreakShortfall(missing)).toBe(
      'Bei mehr als 6 Stunden Arbeit sieht das Arbeitszeitgesetz mindestens 30 Minuten Pause vor, in Abschnitten ab 15 Minuten. Eingetragen sind 0 Minuten. Fehlt eine Pause, trag sie ein.',
    );
  });

  test('exactly six hours need no break; one minute more does', () => {
    expect(shortfall({ start: '07:00', end: '13:00' })).toBeNull();
    expect(shortfall({ start: '07:00', end: '13:01' })).toMatchObject({
      kind: 'total',
      requiredBreakMinutes: 30,
    });
  });

  test('a 30-minute break covers a day up to nine hours of work', () => {
    expect(
      shortfall(
        { start: '07:00', end: '12:00' },
        { kind: 'break', start: '12:00', end: '12:30' },
        { start: '12:30', end: '16:30' },
      ),
    ).toBeNull();
  });

  test('more than nine hours of work need 45 minutes', () => {
    expect(
      shortfall(
        { start: '06:00', end: '12:00' },
        { kind: 'break', start: '12:00', end: '12:30' },
        { start: '12:30', end: '16:00' },
      ),
    ).toEqual({ kind: 'total', workAboveHours: 9, requiredBreakMinutes: 45, countedBreakMinutes: 30 });
  });

  test('travel counts as work, a break under 15 minutes counts as none, and a gap is a rest', () => {
    expect(
      shortfall(
        { kind: 'travel', start: '06:00', end: '07:00' },
        { start: '07:00', end: '10:00' },
        { kind: 'break', start: '10:00', end: '10:10' },
        { start: '10:10', end: '13:30' },
      ),
    ).toEqual({ kind: 'total', workAboveHours: 6, requiredBreakMinutes: 30, countedBreakMinutes: 0 });
    expect(shortfall({ start: '07:00', end: '11:00' }, { start: '11:30', end: '15:30' })).toBeNull();
  });

  test("more than six hours in a row without a rest warn even when the day's breaks add up (§ 4 sentence 3)", () => {
    const stretch = shortfall(
      { start: '07:00', end: '07:30' },
      { kind: 'break', start: '07:30', end: '08:00' },
      { start: '08:00', end: '16:00' },
    );
    expect(stretch).toEqual({ kind: 'stretch', stretchMinutes: 480 });
    expect(stretch && describeBreakShortfall(stretch)).toBe(
      'Nach mehr als 6 Stunden Arbeit am Stück sieht das Arbeitszeitgesetz eine Pause von mindestens 15 Minuten vor. Eingetragen sind 8 Stunden ohne Pause. Fehlt eine Pause, trag sie ein.',
    );
    // A break under 15 minutes does not end the stretch; one of 15 does.
    expect(
      shortfall(
        { start: '07:00', end: '07:30' },
        { kind: 'break', start: '07:30', end: '08:00' },
        { start: '08:00', end: '12:00' },
        { kind: 'break', start: '12:00', end: '12:10' },
        { start: '12:10', end: '14:40' },
      ),
    ).toEqual({ kind: 'stretch', stretchMinutes: 390 });
    expect(
      shortfall(
        { start: '07:00', end: '07:30' },
        { kind: 'break', start: '07:30', end: '08:00' },
        { start: '08:00', end: '12:00' },
        { kind: 'break', start: '12:00', end: '12:15' },
        { start: '12:15', end: '14:45' },
      ),
    ).toBeNull();
  });
});
