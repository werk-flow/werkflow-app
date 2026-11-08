import { describe, expect, test } from 'bun:test';
import {
  planManualEntrySubmission,
  type ManualEntryFormValues,
} from '@/components/manual-entry-submission';

// What „Speichern“ in „Zeit nachtragen“ (the manual entry form) sends. The
// form starts with empty times, so an untouched form marks its fields and
// sends nothing; own time of an earlier day needs a reason and goes in as a
// correction, never as manual entries.

const today = new Date(2026, 9, 29);

function values(overrides: Partial<ManualEntryFormValues> = {}): ManualEntryFormValues {
  return {
    isAdminOrManager: false,
    selectedUserId: 'employee',
    entryMode: 'both',
    selectedDate: today,
    clockInTime: '',
    clockOutTime: '',
    needsReason: false,
    reason: '',
    closedPeriods: [],
    ...overrides,
  };
}

describe('the manual entry form sends', () => {
  test('nothing while untouched: both times are marked as missing', () => {
    expect(planManualEntrySubmission(values())).toEqual({
      kind: 'invalid',
      fieldErrors: {
        member: undefined,
        date: undefined,
        clockIn: 'Bitte gib eine Uhrzeit an.',
        clockOut: 'Bitte gib eine Uhrzeit an.',
        reason: undefined,
      },
    });
  });

  test('nothing for an office user who has not chosen whose time it is', () => {
    const plan = planManualEntrySubmission(
      values({ isAdminOrManager: true, selectedUserId: '', clockInTime: '08:00', clockOutTime: '12:00' }),
    );
    expect(plan.kind).toBe('invalid');
    expect(plan.kind === 'invalid' && plan.fieldErrors.member).toBe('Bitte wähle einen Mitarbeiter aus.');
  });

  test('nothing for a partly typed time', () => {
    const plan = planManualEntrySubmission(values({ clockInTime: '08:', clockOutTime: '12:00' }));
    expect(plan.kind === 'invalid' && plan.fieldErrors.clockIn).toBe('Bitte gib eine Uhrzeit an.');
  });

  test('nothing for an end before the start', () => {
    const plan = planManualEntrySubmission(values({ clockInTime: '09:00', clockOutTime: '08:00' }));
    expect(plan.kind === 'invalid' && plan.fieldErrors.clockOut).toBe(
      'Die Einstempelzeit muss vor der Ausstempelzeit liegen.',
    );
  });

  test('the entries the person typed for the day', () => {
    expect(planManualEntrySubmission(values({ clockInTime: '07:30', clockOutTime: '16:00' }))).toEqual({
      kind: 'entries',
      dateIso: '2026-10-29',
      entries: [
        { entryType: 'clock_in', timestamp: new Date('2026-10-29T07:30:00').toISOString() },
        { entryType: 'clock_out', timestamp: new Date('2026-10-29T16:00:00').toISOString() },
      ],
    });
  });

  test('only the clock-in a forgotten start asks for', () => {
    const plan = planManualEntrySubmission(values({ entryMode: 'clock_in', clockInTime: '07:30' }));
    expect(plan).toEqual({
      kind: 'entries',
      dateIso: '2026-10-29',
      entries: [{ entryType: 'clock_in', timestamp: new Date('2026-10-29T07:30:00').toISOString() }],
    });
  });

  test('nothing for own time of an earlier day without a reason', () => {
    const plan = planManualEntrySubmission(
      values({ needsReason: true, reason: '  ', clockInTime: '07:30', clockOutTime: '16:00' }),
    );
    expect(plan.kind === 'invalid' && plan.fieldErrors.reason).toBe('Bitte gib einen Grund an.');
  });

  test('own time of an earlier day with its reason as a correction, never as manual entries', () => {
    expect(
      planManualEntrySubmission(
        values({ needsReason: true, reason: ' Baustelle ohne Netz ', clockInTime: '07:30', clockOutTime: '16:00' }),
      ),
    ).toEqual({ kind: 'past-day', dateIso: '2026-10-29', reason: 'Baustelle ohne Netz' });
  });

  test('nothing for a day of a closed period', () => {
    const plan = planManualEntrySubmission(
      values({
        clockInTime: '07:30',
        clockOutTime: '16:00',
        closedPeriods: [{ startDate: '2026-10-01', endDate: '2026-10-31' }],
      }),
    );
    expect(plan.kind === 'invalid' && plan.fieldErrors.date).toBeString();
  });
});
