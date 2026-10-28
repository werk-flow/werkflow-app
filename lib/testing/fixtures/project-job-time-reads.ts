// The project time card reads the organization's approved corrections once per
// request, not once per job: a manager's read loads the whole history once, and
// an employee's read loads only their own history once, for the jobs they are
// assigned to.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const projectId = '8d000000-0000-4000-8000-000000000001';
const jobIds = [
  '8d000000-0000-4000-8000-000000000011',
  '8d000000-0000-4000-8000-000000000012',
  '8d000000-0000-4000-8000-000000000013',
];

const world = installActionWorld({
  projects: [{ id: projectId, organization_id: ORGANIZATION_A }],
  jobs: jobIds.map((id) => ({ id, organization_id: ORGANIZATION_A, project_id: projectId })),
  job_assignments: [
    {
      id: '8d000000-0000-4000-8000-000000000021',
      organization_id: ORGANIZATION_A,
      job_id: jobIds[1],
      user_id: CALLER_ID,
    },
  ],
});
const projectionLoads: Array<{ organizationId: string; userIds?: string[] }> = [];
mock.module('@/lib/time-corrections/approved-projection', () => ({
  loadApprovedCorrectionProjection: async (
    _admin: unknown,
    input: { organizationId: string; userIds?: string[] },
  ) => {
    projectionLoads.push({
      organizationId: input.organizationId,
      ...(input.userIds ? { userIds: input.userIds } : {}),
    });
    return [];
  },
}));
const { getTimeEntriesForProjectJobs } = await import('@/lib/time-tracking/entry-read-actions');

signInAs(world, 'admin');
assert.deepEqual(await getTimeEntriesForProjectJobs(projectId), {
  success: true,
  jobs: jobIds.map((jobId) => ({ jobId, entries: [] })),
});
assert.deepEqual(projectionLoads, [{ organizationId: ORGANIZATION_A }]);

projectionLoads.length = 0;
signInAs(world, 'employee');
assert.deepEqual(await getTimeEntriesForProjectJobs(projectId), {
  success: true,
  jobs: [{ jobId: jobIds[1], entries: [] }],
});
assert.deepEqual(projectionLoads, [{ organizationId: ORGANIZATION_A, userIds: [CALLER_ID] }]);
