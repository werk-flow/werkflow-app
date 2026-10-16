import { describe, expect, test } from 'bun:test';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import type { TimeEntry, ValidationResult } from './types';
import { validateDayEntrySequence, validateManualEntries, validateTimestampUpdate } from './validation';
import {
  describeTimeValidationFailure,
  TIME_VALIDATION_CODES,
  TIME_VALIDATION_MESSAGES,
  type TimeValidationFailure,
} from './validation-messages';

// The time rules answer a code and the instants it names; this file pins every
// sentence byte for byte. Berlin switches to summer time on 29 March 2026 at
// 02:00, so the two instants below read 01:45 (CET) and 03:15 (CEST).
const BEFORE_SWITCH = '2026-03-29T00:45:00.000Z';
const AFTER_SWITCH = '2026-03-29T01:15:00.000Z';

const EXPECTED: ReadonlyArray<readonly [TimeValidationFailure, string]> = [
  [
    { error: 'clock_in_during_break' },
    'Während einer laufenden Pause kann kein manueller Arbeitsbeginn hinzugefügt werden.',
  ],
  [
    { error: 'clock_in_while_working' },
    'Ein manueller Arbeitsbeginn ist nur möglich, wenn zu diesem Zeitpunkt keine laufende Arbeitszeit besteht.',
  ],
  [
    { error: 'clock_out_without_open_time' },
    'Ein manuelles Ausstempeln ist nur möglich, wenn zu diesem Zeitpunkt bereits eine laufende Arbeitszeit oder Pause besteht.',
  ],
  [{ error: 'pair_clock_in_not_before_clock_out' }, 'Die Einstempelzeit muss vor der Ausstempelzeit liegen.'],
  [
    { error: 'pair_start_during_break' },
    'Während einer laufenden Pause kann kein manueller Arbeitsblock begonnen werden.',
  ],
  [
    { error: 'pair_start_while_working' },
    'Ein manueller Arbeitsblock kann nur beginnen, wenn zu diesem Zeitpunkt keine laufende Arbeitszeit besteht.',
  ],
  [{ error: 'break_start_not_before_end' }, 'Der Pausenbeginn muss vor dem Pausenende liegen.'],
  [{ error: 'manual_entries_missing' }, 'Mindestens ein Eintrag ist erforderlich.'],
  [{ error: 'manual_timestamp_invalid' }, 'Ungültiges Datum oder Uhrzeit.'],
  [{ error: 'manual_entry_in_future' }, 'Manuelle Einträge können nicht in der Zukunft liegen.'],
  [{ error: 'manual_entries_span_days' }, 'Manuelle Einträge müssen innerhalb desselben Tages liegen.'],
  [
    { error: 'job_on_clock_out' },
    'Ein Auftrag kann nur einem Eintrag zugewiesen werden, der einen Arbeitsblock startet.',
  ],
  [{ error: 'edited_entry_missing' }, 'Eintrag nicht gefunden.'],
  [{ error: 'edited_timestamp_in_future' }, 'Zeitstempel kann nicht in der Zukunft liegen.'],
  [
    { error: 'entry_minute_taken', at: AFTER_SWITCH },
    'Ein Eintrag existiert bereits um 03:15. Der früheste verfügbare Zeitpunkt ist eine Minute später.',
  ],
  [
    { error: 'sequence_clock_in_while_open', at: BEFORE_SWITCH },
    'Ungültige Eintragsfolge um 01:45: Ein Arbeitsblock kann nur begonnen werden, wenn keine laufende Arbeitszeit oder Pause besteht.',
  ],
  [
    { error: 'sequence_break_start_not_working', at: AFTER_SWITCH },
    'Ungültige Eintragsfolge um 03:15: Eine Pause kann nur während einer laufenden Arbeitszeit gestartet werden.',
  ],
  [
    { error: 'sequence_break_end_not_on_break', at: AFTER_SWITCH },
    'Ungültige Eintragsfolge um 03:15: Eine Pause kann nur beendet werden, wenn zu diesem Zeitpunkt bereits eine Pause läuft.',
  ],
  [
    { error: 'sequence_clock_out_while_clocked_out', at: BEFORE_SWITCH },
    'Ungültige Eintragsfolge um 01:45: Ausstempeln ist nur während einer laufenden Arbeitszeit oder Pause möglich.',
  ],
  [
    { error: 'pair_overlaps_work', start: BEFORE_SWITCH, end: AFTER_SWITCH },
    'Der neue Zeitraum überschneidet sich mit einer bestehenden Arbeitszeit (29.03., 01:45 - 03:15). Manuelle Einträge müssen vollständig außerhalb bestehender Zeitfenster liegen.',
  ],
  [
    { error: 'pair_overlaps_break', start: BEFORE_SWITCH, end: null },
    'Der neue Zeitraum überschneidet sich mit einer bestehenden Pause (01:45 - offen). Manuelle Arbeitszeiten müssen vollständig außerhalb bestehender Pausen liegen.',
  ],
  [
    { error: 'clock_in_inside_work', start: BEFORE_SWITCH, end: null },
    'Der gewählte Zeitpunkt liegt innerhalb einer bestehenden Arbeitszeit (01:45 - offen).',
  ],
  [
    { error: 'clock_in_inside_break', start: BEFORE_SWITCH, end: AFTER_SWITCH },
    'Der gewählte Zeitpunkt liegt innerhalb einer bestehenden Pause (01:45 - 03:15). Manuelle Arbeitszeiten müssen vollständig außerhalb von Pausen liegen.',
  ],
  [
    { error: 'clock_out_inside_closed_work', start: BEFORE_SWITCH, end: AFTER_SWITCH },
    'Der gewählte Zeitpunkt liegt innerhalb einer bestehenden abgeschlossenen Arbeitszeit (01:45 - 03:15).',
  ],
  [
    { error: 'clock_out_inside_closed_break', start: BEFORE_SWITCH, end: AFTER_SWITCH },
    'Der gewählte Zeitpunkt liegt innerhalb einer bestehenden abgeschlossenen Pause (01:45 - 03:15).',
  ],
];

function timeEntry(id: string, entryType: TimeEntry['entryType'], timestamp: string): TimeEntry {
  return {
    id,
    userId: 'user-1',
    organizationId: 'org-1',
    entryType,
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('time rule sentences', () => {
  test('every code yields its exact sentence, with Berlin times across the summer-time switch', () => {
    const pinnedCodes: string[] = EXPECTED.map(([failure]) => failure.error);
    expect(pinnedCodes.sort()).toEqual([...TIME_VALIDATION_CODES].sort());
    for (const [failure, sentence] of EXPECTED) {
      expect(describeTimeValidationFailure(failure), failure.error).toBe(sentence);
    }
  });

  test('an action failure reads back into the same sentence through describeFailure', () => {
    for (const [failure, sentence] of EXPECTED) {
      const answered = { success: false, ...failure };
      expect(describeFailure(answered, TIME_VALIDATION_MESSAGES, 'Fehler.'), failure.error).toBe(sentence);
    }
  });

  test('a failure without the facts its sentence names falls back, and other codes are not time rules', () => {
    const sentenceOf = (failure: { error: string; start?: string; end?: number }): string =>
      describeFailure(failure, TIME_VALIDATION_MESSAGES, 'Fehler.');
    expect(sentenceOf({ error: 'entry_minute_taken' })).toBe('Fehler.');
    expect(sentenceOf({ error: 'pair_overlaps_break', start: BEFORE_SWITCH })).toBe('Fehler.');
    expect(sentenceOf({ error: 'pair_overlaps_break', start: BEFORE_SWITCH, end: 5 })).toBe('Fehler.');
    expect(sentenceOf({ error: 'insert_failed' })).toBe('Fehler.');
    expect(sentenceOf({ error: 'invalid_input' })).toBe(SHARED_FAILURE_MESSAGES.invalid_input);
  });

  test('a sentence cannot be a time rule code', () => {
    // @ts-expect-error -- Tier 1 probe: the failure arm takes a code from the closed union, never a sentence.
    const sentence: ValidationResult = { valid: false, failure: { error: 'Eintrag nicht gefunden.' } };
    expect(sentence.valid).toBe(false);
  });
});

describe('the validators answer codes with the instants as data', () => {
  test('manual entries', () => {
    expect(validateManualEntries([], [])).toEqual({
      valid: false,
      failure: { error: 'manual_entries_missing' },
    });
    expect(validateManualEntries([], [{ entryType: 'clock_in', timestamp: 'gestern' }])).toEqual({
      valid: false,
      failure: { error: 'manual_timestamp_invalid' },
    });
    expect(
      validateManualEntries([], [{ entryType: 'clock_in', timestamp: '2099-01-05T08:00:00.000Z' }]),
    ).toEqual({
      valid: false,
      failure: { error: 'manual_entry_in_future' },
    });

    const existingIn = timeEntry('in', 'clock_in', '2026-03-10T07:00:00.000Z');
    const result = validateManualEntries(
      [existingIn],
      [{ entryType: 'clock_in', timestamp: existingIn.timestamp }],
    );
    expect(result).toEqual({
      valid: false,
      failure: { error: 'entry_minute_taken', at: existingIn.timestamp },
    });
  });

  test('day sequence and timestamp updates', () => {
    const breakStart = timeEntry('break', 'break_start', '2026-03-10T09:00:00.000Z');
    expect(validateDayEntrySequence([breakStart])).toEqual({
      valid: false,
      failure: { error: 'sequence_break_start_not_working', at: breakStart.timestamp },
    });
    expect(validateTimestampUpdate([], 'missing', new Date('2026-03-10T09:00:00.000Z'))).toEqual({
      valid: false,
      failure: { error: 'edited_entry_missing' },
    });
  });
});
