import { expect, test } from 'bun:test';

import { snapshotSegments } from './snapshot-segments';
import type { TimeCorrectionFact } from './types';

const JOB = '40000000-0000-4000-8000-000000000001';

function fact(
  entryType: TimeCorrectionFact['entryType'],
  timestamp: string,
  values: Partial<TimeCorrectionFact> = {},
): TimeCorrectionFact {
  return {
    factId: `${entryType}-${timestamp}`,
    employeeRecordId: 'record',
    userId: 'user',
    entryType,
    timestamp,
    jobId: null,
    activityKind: null,
    isManual: true,
    ...values,
  };
}

test('a reviewer reads each activity of a proposal with its job, the break included', () => {
  expect(
    snapshotSegments([
      fact('clock_in', '2026-10-26T06:00:00.000Z', { activityKind: 'work', jobId: JOB }),
      fact('break_start', '2026-10-26T10:00:00.000Z', { activityKind: 'break' }),
      fact('break_end', '2026-10-26T10:30:00.000Z', { activityKind: 'work', jobId: JOB }),
      fact('clock_out', '2026-10-26T12:00:00.000Z', { activityKind: 'travel', jobId: JOB }),
      fact('clock_in', '2026-10-26T12:00:00.000Z', { activityKind: 'travel', jobId: JOB }),
      fact('clock_out', '2026-10-26T12:30:00.000Z', { activityKind: 'travel', jobId: JOB }),
    ]),
  ).toEqual([
    {
      startedAt: '2026-10-26T06:00:00.000Z',
      endedAt: '2026-10-26T10:00:00.000Z',
      activityKind: 'work',
      jobId: JOB,
    },
    {
      startedAt: '2026-10-26T10:00:00.000Z',
      endedAt: '2026-10-26T10:30:00.000Z',
      activityKind: 'break',
      jobId: null,
    },
    {
      startedAt: '2026-10-26T10:30:00.000Z',
      endedAt: '2026-10-26T12:00:00.000Z',
      activityKind: 'work',
      jobId: JOB,
    },
    {
      startedAt: '2026-10-26T12:00:00.000Z',
      endedAt: '2026-10-26T12:30:00.000Z',
      activityKind: 'travel',
      jobId: JOB,
    },
  ]);
});

test('the midnight split of an overnight proposal reads as one activity; an open one has no end', () => {
  expect(
    snapshotSegments([
      fact('clock_in', '2026-10-20T20:00:00.000Z', { activityKind: 'callout', jobId: JOB }),
      fact('clock_out', '2026-10-20T22:00:00.000Z', { activityKind: 'callout', jobId: JOB }),
      fact('clock_in', '2026-10-20T22:00:00.000Z', { activityKind: 'callout', jobId: JOB }),
      fact('clock_out', '2026-10-20T23:30:00.000Z', { activityKind: 'callout', jobId: JOB }),
      fact('clock_in', '2026-10-21T06:00:00.000Z'),
    ]),
  ).toEqual([
    {
      startedAt: '2026-10-20T20:00:00.000Z',
      endedAt: '2026-10-20T23:30:00.000Z',
      activityKind: 'callout',
      jobId: JOB,
    },
    { startedAt: '2026-10-21T06:00:00.000Z', endedAt: null, activityKind: 'work', jobId: null },
  ]);
});
