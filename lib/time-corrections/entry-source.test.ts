import { expect, test } from 'bun:test';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { correctionSource, entryCorrectionTarget } from './entry-source';
import { calendarCorrectionBoundaries } from './calendar-draft';
import { correctionFactToEntry } from './types';

const entry = correctionFactToEntry(
  {
    factId: 'fact',
    employeeRecordId: 'employee',
    userId: 'user',
    entryType: 'clock_in',
    timestamp: '2026-09-08T06:00:00.000Z',
    jobId: null,
    activityKind: 'work',
    isManual: true,
  },
  {
    applicationId: 'application',
    appliedAt: '2026-09-09T06:00:00.000Z',
    appliedBy: 'approver',
    sourceFingerprint: 'fingerprint',
  },
);

test('Verlauf can correct added time using the same application source as the calendar', () => {
  expect(correctionSource(entry)).toEqual({ kind: 'correction_application', id: 'application' });
  expect(entryCorrectionTarget(entry)).toEqual({
    kind: 'correction_application',
    id: 'application',
    factId: 'fact',
  });
  expect(entryCorrectionTarget({ ...entry, id: 'unrelated' })).toBeNull();
  expect(
    calendarCorrectionBoundaries({ sourceEntries: [entry], updates: [] }, [
      { userId: 'user', employeeRecordId: 'employee' },
    ])?.map((boundary) => boundary.source),
  ).toEqual([{ kind: 'correction_application', id: 'application', version: 'fingerprint' }]);
});

test('clock and legacy entries keep their correction sources', () => {
  const base: TimeEntry = { ...entry, correctionApplicationId: undefined };
  expect(
    correctionSource({ ...base, sourceKind: 'canonical_segment', canonicalSegmentId: 'segment' }),
  ).toEqual({ kind: 'canonical_segment', id: 'segment' });
  expect(correctionSource({ ...base, sourceKind: 'legacy_entry', id: 'legacy' })).toEqual({
    kind: 'legacy_entry',
    id: 'legacy',
  });
});
