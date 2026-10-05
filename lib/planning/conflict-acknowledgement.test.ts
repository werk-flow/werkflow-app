// Rule test: a conflicting planning write is saved only with a reason and the fingerprint of the assessment the manager saw.
import { expect, test } from 'bun:test';

import { rejectUnacknowledgedConflicts } from './conflict-acknowledgement';
import type { PlanningConflict } from './types';

const overlap: PlanningConflict = {
  kind: 'overlap',
  severity: 'warning',
  employeeRecordId: null,
  localDate: '2026-10-05',
  message: 'Überschneidung mit einem anderen Einsatz.',
  details: {},
};
const assessed = { conflicts: [overlap], assessmentFingerprint: 'seen' };

test('a write without conflicts needs no acknowledgement', () => {
  const clean = { conflicts: [], assessmentFingerprint: 'seen' };
  expect(
    rejectUnacknowledgedConflicts(clean, { overrideReason: null, assessmentFingerprint: null }),
  ).toBeNull();
});

test('a conflict without a reason returns the warning with its conflicts and fingerprint', () => {
  expect(
    rejectUnacknowledgedConflicts(assessed, { overrideReason: null, assessmentFingerprint: 'seen' }),
  ).toEqual({ success: false, error: 'planning_warning', conflicts: [overlap], fingerprint: 'seen' });
});

test('a reason for an older assessment is refused as stale', () => {
  expect(
    rejectUnacknowledgedConflicts(assessed, {
      overrideReason: 'Kunde besteht auf dem Termin.',
      assessmentFingerprint: 'older',
    }),
  ).toEqual({ success: false, error: 'stale_assessment', conflicts: [overlap], fingerprint: 'seen' });
});

test('a reason for the assessment the manager saw lets the write through', () => {
  expect(
    rejectUnacknowledgedConflicts(assessed, {
      overrideReason: 'Kunde besteht auf dem Termin.',
      assessmentFingerprint: 'seen',
    }),
  ).toBeNull();
});
