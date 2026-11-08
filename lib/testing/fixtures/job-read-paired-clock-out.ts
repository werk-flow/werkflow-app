// A same-day manual entry names the job on its clock-in only. The job's read
// keeps the jobless break and clock-out that follow that clock-in, after the
// approved corrections, so a reader such as the Arbeitsbericht's visit window
// sees the session closed, and it returns no entry of another job.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const jobId = '8e000000-0000-4000-8000-000000000011';
const otherJobId = '8e000000-0000-4000-8000-000000000012';
const workerId = '8e000000-0000-4000-8000-000000000031';
const pairIn = '8e000000-0000-4000-8000-000000000041';
const pairOut = '8e000000-0000-4000-8000-000000000042';
const otherIn = '8e000000-0000-4000-8000-000000000043';
const otherOut = '8e000000-0000-4000-8000-000000000044';
const breakDayIn = '8e000000-0000-4000-8000-000000000045';
const breakDayBreak = '8e000000-0000-4000-8000-000000000046';
const breakDayOut = '8e000000-0000-4000-8000-000000000047';
const correctedDayIn = '8e000000-0000-4000-8000-000000000048';
const correctedDayOut = '8e000000-0000-4000-8000-000000000049';
const correctionId = '8e000000-0000-4000-8000-000000000051';

type EntryType = 'clock_in' | 'clock_out' | 'break_start';
const row = (id: string, entryType: EntryType, timestamp: string, job: string | null) => ({
  id,
  organization_id: ORGANIZATION_A,
  user_id: workerId,
  entry_type: entryType,
  timestamp,
  job_id: job,
  status: 'approved',
  is_manual: true,
  reviewed_by: null,
  reviewed_at: null,
  created_at: timestamp,
  updated_at: timestamp,
});

// The office corrected the third day's jobless clock-out from 11:00 to 12:00.
const correction: TimeCorrectionApplicationProjection = {
  applicationId: correctionId,
  requestId: '8e000000-0000-4000-8000-000000000052',
  appliedAt: '2026-03-05T08:00:00.000Z',
  appliedBy: '8e000000-0000-4000-8000-000000000032',
  sourceFingerprint: 'a'.repeat(64),
  sources: [{ kind: 'legacy_entry', id: correctedDayOut, version: 'v1' }],
  snapshot: {
    schemaVersion: 1,
    facts: [
      {
        factId: 'end',
        employeeRecordId: '8e000000-0000-4000-8000-000000000033',
        userId: workerId,
        entryType: 'clock_out',
        timestamp: '2026-03-04T12:00:00.000Z',
        jobId: null,
        activityKind: null,
        isManual: true,
      },
    ],
  },
};

const world = installActionWorld({
  jobs: [jobId, otherJobId].map((id) => ({ id, organization_id: ORGANIZATION_A, project_id: null })),
  time_entries: [
    row(pairIn, 'clock_in', '2026-03-02T07:00:00.000Z', jobId),
    row(pairOut, 'clock_out', '2026-03-02T11:00:00.000Z', null),
    row(otherIn, 'clock_in', '2026-03-02T12:00:00.000Z', otherJobId),
    row(otherOut, 'clock_out', '2026-03-02T14:00:00.000Z', null),
    // The worker clocked out during a break.
    row(breakDayIn, 'clock_in', '2026-03-03T07:00:00.000Z', jobId),
    row(breakDayBreak, 'break_start', '2026-03-03T09:00:00.000Z', null),
    row(breakDayOut, 'clock_out', '2026-03-03T09:30:00.000Z', null),
    row(correctedDayIn, 'clock_in', '2026-03-04T07:00:00.000Z', jobId),
    row(correctedDayOut, 'clock_out', '2026-03-04T11:00:00.000Z', null),
  ],
});
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [correction],
}));
const { getTimeEntriesForJob } = await import('@/lib/time-tracking/entry-read-actions');

signInAs(world, 'admin');
const read = await getTimeEntriesForJob(jobId);
assert.ok(read.success, JSON.stringify(read));
assert.deepEqual(
  read.entries.map(({ id }) => id),
  [pairIn, pairOut, breakDayIn, breakDayBreak, breakDayOut, correctedDayIn, `correction:${correctionId}:end`],
  'the job keeps the jobless break and clock-outs after its clock-ins, corrected, and nothing of the other job',
);
