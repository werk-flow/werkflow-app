import { describe, expect, test } from 'bun:test';

import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

import {
  hasUnclosedLegacySequence,
  projectLegacyEntriesForWindow,
} from './legacy-projection';

const organizationId = '10000000-0000-0000-0000-000000000001';
const userId = '10000000-0000-0000-0000-000000000002';
const employeeRecordId = '10000000-0000-0000-0000-000000000003';
const augustClockIn: TimeEntry = {
  id: '10000000-0000-0000-0000-000000000004',
  userId,
  organizationId,
  entryType: 'clock_in',
  timestamp: '2026-08-01T06:00:00.000Z',
  isManual: true,
  jobId: null,
  status: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-09-04T16:28:03.000Z',
  updatedAt: '2026-09-04T16:28:03.000Z',
};

function correctionApplication(input: {
  applicationId: string;
  timestamp: string;
  entryType: 'clock_in' | 'clock_out';
  sources?: TimeCorrectionApplicationProjection['sources'];
}): TimeCorrectionApplicationProjection {
  return {
    applicationId: input.applicationId,
    requestId: crypto.randomUUID(),
    appliedAt: '2026-09-04T16:27:40.000Z',
    appliedBy: '10000000-0000-0000-0000-000000000005',
    sourceFingerprint: 'a'.repeat(64),
    sources: input.sources ?? [],
    snapshot: {
      schemaVersion: 1,
      facts: [
        {
          factId: 'fact',
          employeeRecordId,
          userId,
          entryType: input.entryType,
          timestamp: input.timestamp,
          jobId: null,
          activityKind: 'work',
          isManual: true,
        },
      ],
    },
  };
}

describe('legacy time-account period projection', () => {
  test('an out-of-period correction cannot close an in-period sequence', () => {
    const projected = projectLegacyEntriesForWindow({
      entries: [augustClockIn],
      applications: [
        correctionApplication({
          applicationId: '20000000-0000-0000-0000-000000000001',
          entryType: 'clock_out',
          timestamp: '2026-12-31T08:30:00.000Z',
        }),
      ],
      organizationId,
      startInstant: '2026-07-31T22:00:00.000Z',
      endInstant: '2026-08-31T22:00:00.000Z',
    });

    expect(projected.map((entry) => entry.id)).toEqual([augustClockIn.id]);
    expect(hasUnclosedLegacySequence(projected)).toBe(true);
  });

  test('a correction that moves the source outside the window removes it', () => {
    const projected = projectLegacyEntriesForWindow({
      entries: [augustClockIn],
      applications: [
        correctionApplication({
          applicationId: '20000000-0000-0000-0000-000000000002',
          entryType: 'clock_in',
          timestamp: '2026-09-01T06:00:00.000Z',
          sources: [
            {
              kind: 'legacy_entry',
              id: augustClockIn.id,
              version: 'v1',
            },
          ],
        }),
      ],
      organizationId,
      startInstant: '2026-07-31T22:00:00.000Z',
      endInstant: '2026-08-31T22:00:00.000Z',
    });

    expect(projected).toEqual([]);
  });
});
