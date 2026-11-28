// The job's and the project's time lists count only the approved correction
// facts of each person's effective employee record. A person whose old record
// was removed and who holds a new one sees none of the facts the old record
// retains, in their own job list and in the office's (docs/technical/security.md,
// "Calendar correction input boundary"; werk-flow/werkflow-planning#612).
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const projectId = '8f000000-0000-4000-8000-000000000001';
const jobId = '8f000000-0000-4000-8000-000000000011';
const foreignJobId = '8f000000-0000-4000-8000-000000000012';
const removedRecord = '8f000000-0000-4000-8000-000000000021';
const currentRecord = '8f000000-0000-4000-8000-000000000022';

/** An approved correction that added a shift on the job to the caller's time on one record. */
function addedShift(id: string, employeeRecordId: string): TimeCorrectionApplicationProjection {
  const fact = (entryType: 'clock_in' | 'clock_out', timestamp: string) => ({
    factId: entryType,
    employeeRecordId,
    userId: CALLER_ID,
    entryType,
    timestamp,
    jobId,
    activityKind: 'work' as const,
    isManual: true,
  });
  return {
    applicationId: id,
    requestId: `request-${id}`,
    appliedAt: '2026-03-05T08:00:00.000Z',
    appliedBy: CALLER_ID,
    sourceFingerprint: id,
    snapshot: {
      schemaVersion: 1,
      facts: [fact('clock_in', '2026-03-04T07:00:00.000Z'), fact('clock_out', '2026-03-04T11:00:00.000Z')],
    },
    sources: [],
  };
}

const world = installActionWorld({
  projects: [
    { id: projectId, organization_id: ORGANIZATION_A },
    { id: '8f000000-0000-4000-8000-000000000002', organization_id: ORGANIZATION_B },
  ],
  jobs: [
    { id: jobId, organization_id: ORGANIZATION_A, project_id: projectId },
    { id: foreignJobId, organization_id: ORGANIZATION_B, project_id: null },
  ],
  job_assignments: [
    {
      id: '8f000000-0000-4000-8000-000000000031',
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      user_id: CALLER_ID,
    },
  ],
  // The caller's old record lost its login; they hold a new one.
  employee_records: [
    { id: removedRecord, organization_id: ORGANIZATION_A, user_id: null },
    { id: currentRecord, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
  ],
});
const applications = [addedShift('removed', removedRecord), addedShift('current', currentRecord)];
// As read_time_correction_applications filters by person: every application with one of their facts.
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async (_admin: unknown, input: { userIds?: string[] }) =>
    applications.filter((application) =>
      application.snapshot.facts.some((fact) => !input.userIds || input.userIds.includes(fact.userId)),
    ),
}));
const { getTimeEntriesForJob, getTimeEntriesForProjectJobs } = await import(
  '@/lib/time-tracking/entry-read-actions'
);

/** The entry ids of the job's list and of the project's list of that job. */
async function jobListIds(): Promise<{ job: string[]; project: string[] }> {
  const job = await getTimeEntriesForJob(jobId);
  assert.ok(job.success, JSON.stringify(job));
  const project = await getTimeEntriesForProjectJobs(projectId);
  assert.ok(project.success, JSON.stringify(project));
  assert.equal(project.jobs.length, 1);
  return {
    job: job.entries.map((entry) => entry.id),
    project: project.jobs.flatMap((read) => read.entries.map((entry) => entry.id)),
  };
}
const currentFacts = ['correction:current:clock_in', 'correction:current:clock_out'];

for (const role of ['employee', 'admin'] as const) {
  signInAs(world, role);
  assert.deepEqual(
    await jobListIds(),
    { job: currentFacts, project: currentFacts },
    `the ${role}'s job and project lists count no fact of the removed record`,
  );
}

// Without a record the person holds now, no fact counts.
world.tables.employee_records = [{ id: removedRecord, organization_id: ORGANIZATION_A, user_id: null }];
for (const role of ['employee', 'admin'] as const) {
  signInAs(world, role);
  assert.deepEqual(
    await jobListIds(),
    { job: [], project: [] },
    `the ${role}'s lists show no correction fact of a person without a record`,
  );
}

// A foreign organization's job stays refused.
signInAs(world, 'admin');
assert.deepEqual(await getTimeEntriesForJob(foreignJobId), { success: false, error: 'not_a_member' });
