import { describe, expect, test } from 'bun:test';

import type { TimeEntry } from '@/lib/time-tracking/types';

import { applyApprovedTimeCorrections } from './projection';
import type { TimeCorrectionApplicationProjection } from './types';

const baseEntry: TimeEntry = {
  id: '10000000-0000-0000-0000-000000000001',
  userId: '10000000-0000-0000-0000-000000000002',
  organizationId: '10000000-0000-0000-0000-000000000003',
  entryType: 'clock_in',
  timestamp: '2026-09-01T06:00:00.000Z',
  isManual: true,
  jobId: null,
  status: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-09-01T06:00:00.000Z',
  updatedAt: '2026-09-01T06:00:00.000Z',
  sourceKind: 'legacy_entry',
  sourceVersion: '2026-09-01 06:00:00+00',
};

function application(input: {
  id: string;
  sourceKind: TimeCorrectionApplicationProjection['sources'][number]['kind'];
  sourceId: string;
  timestamp: string;
}): TimeCorrectionApplicationProjection {
  return {
    applicationId: input.id,
    requestId: crypto.randomUUID(),
    appliedAt: '2026-09-01T08:00:00.000Z',
    appliedBy: '10000000-0000-0000-0000-000000000004',
    sourceFingerprint: 'a'.repeat(64),
    sources: [{ kind: input.sourceKind, id: input.sourceId, version: 'v1' }],
    snapshot: {
      schemaVersion: 1,
      facts: [{
        factId: 'start',
        employeeRecordId: '10000000-0000-0000-0000-000000000005',
        userId: baseEntry.userId,
        entryType: 'clock_in',
        timestamp: input.timestamp,
        jobId: null,
        activityKind: null,
        isManual: true,
      }],
    },
  };
}

describe('applyApprovedTimeCorrections', () => {
  test('replaces a raw fact without mutating the source record', () => {
    const result = applyApprovedTimeCorrections(
      [baseEntry],
      [application({
        id: '20000000-0000-0000-0000-000000000001',
        sourceKind: 'legacy_entry',
        sourceId: baseEntry.id,
        timestamp: '2026-09-01T06:15:00.000Z',
      })],
      baseEntry.organizationId
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.timestamp).toBe('2026-09-01T06:15:00.000Z');
    expect(result[0]?.correctionApplicationId).toBe(
      '20000000-0000-0000-0000-000000000001'
    );
    expect(baseEntry.timestamp).toBe('2026-09-01T06:00:00.000Z');
  });

  test('shows only the newest application in a sequential correction chain', () => {
    const first = application({
      id: '20000000-0000-0000-0000-000000000002',
      sourceKind: 'legacy_entry',
      sourceId: baseEntry.id,
      timestamp: '2026-09-01T06:15:00.000Z',
    });
    const second = application({
      id: '20000000-0000-0000-0000-000000000003',
      sourceKind: 'correction_application',
      sourceId: first.applicationId,
      timestamp: '2026-09-01T06:30:00.000Z',
    });
    const result = applyApprovedTimeCorrections(
      [baseEntry],
      [first, second],
      baseEntry.organizationId
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.timestamp).toBe('2026-09-01T06:30:00.000Z');
  });
});
