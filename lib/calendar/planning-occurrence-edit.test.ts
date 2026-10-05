import { describe, expect, test } from 'bun:test';
import type { PlanningConflict } from '@/lib/planning/types';
import {
  checkPlanningOccurrenceEdit,
  planningEditSuccessMessage,
  planningStatusChangeMessage,
  type PlanningOccurrenceEditDraft,
} from './planning-occurrence-edit';

const conflict: PlanningConflict = {
  kind: 'over_capacity',
  severity: 'warning',
  employeeRecordId: 'record-1',
  localDate: '2026-10-05',
  message: 'Kapazität überschritten',
  details: {},
};

const timedEdit: PlanningOccurrenceEditDraft = {
  date: '2026-10-05',
  time: '08:30',
  durationHours: '2',
  timeKind: 'timed',
  employeeRecordIds: ['record-1'],
  conflicts: [],
  fingerprint: null,
  reason: '',
};

describe('checkPlanningOccurrenceEdit', () => {
  test('lists the missing date, invalid duration and short reason in visual order', () => {
    const check = checkPlanningOccurrenceEdit({
      ...timedEdit,
      date: '',
      durationHours: '0,1',
      conflicts: [conflict],
      reason: 'kurz',
    });
    expect(check.kind).toBe('missing');
    if (check.kind !== 'missing') return;
    expect(check.inputs.map((input) => [input.field, input.elementId])).toEqual([
      ['date', 'planning-edit-date'],
      ['duration', 'planning-edit-duration'],
      ['reason', 'planning-edit-reason'],
    ]);
  });

  test('builds a timed edit without an override while no warning is shown', () => {
    expect(checkPlanningOccurrenceEdit(timedEdit)).toEqual({
      kind: 'ready',
      input: {
        plannedDate: '2026-10-05',
        plannedTime: '08:30',
        estimatedDurationMinutes: 120,
        selectedEmployeeRecordIds: ['record-1'],
        overrideReason: null,
        assessmentFingerprint: null,
      },
    });
  });

  test('keeps time and duration of an all-day occurrence and carries the override decision', () => {
    const check = checkPlanningOccurrenceEdit({
      ...timedEdit,
      timeKind: 'all_day',
      durationHours: '',
      conflicts: [conflict],
      fingerprint: 'fingerprint-1',
      reason: 'Kunde wünscht den Termin',
    });
    expect(check).toEqual({
      kind: 'ready',
      input: {
        plannedDate: '2026-10-05',
        selectedEmployeeRecordIds: ['record-1'],
        overrideReason: 'Kunde wünscht den Termin',
        assessmentFingerprint: 'fingerprint-1',
      },
    });
  });
});

describe('planning edit messages', () => {
  test('name the changed scope and the status change', () => {
    expect(planningEditSuccessMessage('one')).toBe('Termin wurde angepasst.');
    expect(planningEditSuccessMessage('future')).toBe('Dieser und zukünftige Termine wurden angepasst.');
    expect(planningEditSuccessMessage('series')).toBe('Alle noch änderbaren Serientermine wurden angepasst.');
    expect(planningStatusChangeMessage('skipped')).toBe('Termin wurde ausgelassen.');
    expect(planningStatusChangeMessage('cancelled')).toBe('Termin wurde abgesagt.');
  });
});
