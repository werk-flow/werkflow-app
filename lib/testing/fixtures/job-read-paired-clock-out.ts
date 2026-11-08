// A same-day manual pair names the job on its clock-in only. The job's read
// keeps the clock-out that ends that session, so a reader such as the
// Arbeitsbericht's visit window sees the session closed, and it returns no
// entry of another job.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const jobId = '8e000000-0000-4000-8000-000000000011';
const otherJobId = '8e000000-0000-4000-8000-000000000012';
const workerId = '8e000000-0000-4000-8000-000000000031';
const pairIn = '8e000000-0000-4000-8000-000000000041';
const pairOut = '8e000000-0000-4000-8000-000000000042';
const otherIn = '8e000000-0000-4000-8000-000000000043';
const otherOut = '8e000000-0000-4000-8000-000000000044';

const row = (id: string, entryType: 'clock_in' | 'clock_out', timestamp: string, job: string | null) => ({
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

const world = installActionWorld({
  jobs: [jobId, otherJobId].map((id) => ({ id, organization_id: ORGANIZATION_A, project_id: null })),
  time_entries: [
    row(pairIn, 'clock_in', '2026-03-02T07:00:00.000Z', jobId),
    row(pairOut, 'clock_out', '2026-03-02T11:00:00.000Z', null),
    row(otherIn, 'clock_in', '2026-03-02T12:00:00.000Z', otherJobId),
    row(otherOut, 'clock_out', '2026-03-02T14:00:00.000Z', null),
  ],
});
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async () => [],
}));
const { getTimeEntriesForJob } = await import('@/lib/time-tracking/entry-read-actions');

signInAs(world, 'admin');
const read = await getTimeEntriesForJob(jobId);
assert.ok(read.success, JSON.stringify(read));
assert.deepEqual(
  read.entries.map(({ id }) => id),
  [pairIn, pairOut],
  "the job keeps its session's jobless clock-out and nothing of the other job",
);
