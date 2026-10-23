// Actual job and instruction-item actions over the in-memory database: an
// employee creates no job, reads no client's or member's jobs and edits no
// instruction item, and is refused before the database; an employee reads
// and ticks off items only on a job they are assigned to; and a manager of
// organization A reaches no client, member, project, job or item of
// organization B. A refused call writes nothing.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const ownJobId = '8a000000-0000-4000-8000-000000000001';
const ownItemId = '8a000000-0000-4000-8000-000000000002';
const foreignJobId = '8a000000-0000-4000-8000-000000000003';
const foreignProjectId = '8a000000-0000-4000-8000-000000000004';
const foreignClientId = '8a000000-0000-4000-8000-000000000005';
const foreignItemId = '8a000000-0000-4000-8000-000000000006';
const foreignUserId = '8a000000-0000-4000-8000-000000000007';

const instructionItem = (id: string, organizationId: string, jobId: string) => ({
  id,
  organization_id: organizationId,
  job_id: jobId,
  project_id: null,
  content: 'Heizkörper entlüften',
  is_completed: false,
  completion_version: 1,
  sort_order: 0,
});
const world = installActionWorld({
  jobs: [
    {
      id: ownJobId,
      organization_id: ORGANIZATION_A,
      client_id: null,
      project_id: null,
      status: 'in_bearbeitung',
    },
    {
      id: foreignJobId,
      organization_id: ORGANIZATION_B,
      client_id: foreignClientId,
      project_id: foreignProjectId,
      status: 'geparkt',
      updated_at: '2026-10-01T08:00:00.000Z',
    },
  ],
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B, client_id: foreignClientId }],
  job_assignments: [
    {
      id: '8a000000-0000-4000-8000-000000000008',
      organization_id: ORGANIZATION_B,
      job_id: foreignJobId,
      user_id: foreignUserId,
    },
  ],
  job_instruction_items: [
    instructionItem(ownItemId, ORGANIZATION_A, ownJobId),
    instructionItem(foreignItemId, ORGANIZATION_B, foreignJobId),
  ],
});
const { createJob, getJobsForClient, getJobsForMember, getNextJobNumber, getParkedJobs } = await import(
  '@/lib/jobs/actions'
);
const {
  createProjectInstructionItem,
  getJobInstructionItems,
  getProjectInstructionItems,
  toggleJobInstructionItemCompletion,
  updateInstructionItemDetails,
  updateJobInstructionItemContent,
} = await import('@/lib/jobs/instruction-items-actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const itemDetails = (itemId: string) =>
  updateInstructionItemDetails({
    itemId,
    itemKind: 'checklist',
    requirementState: 'required',
    evidence: [],
    predecessorItemIds: [],
  });
const relatedNothing = { success: true, jobs: [], projects: [], clientMap: {}, jobAssignmentMap: {} };

// A caller without an organization gets no job number.
signInAs(world, null);
assert.deepEqual(await getNextJobNumber(), { success: false, error: 'no_active_org' });
assert.equal(world.adminClientRequests, 0);

// An employee creates no job and reads no client's, member's or project's work, before any database access.
signInAs(world, 'employee');
assert.deepEqual(await createJob({ title: 'Neuer Auftrag' }), notAuthorized);
assert.deepEqual(await getJobsForClient(foreignClientId), notAuthorized);
assert.deepEqual(await getJobsForMember(foreignUserId), notAuthorized);
assert.deepEqual(await getProjectInstructionItems(foreignProjectId), notAuthorized);
assert.deepEqual(
  await createProjectInstructionItem({ projectId: foreignProjectId, content: 'Prüfen' }),
  notAuthorized,
);
assert.equal(world.adminClientRequests, 0);

// An employee reads and ticks off items only on a job they are assigned to, and edits none.
assert.deepEqual(await getJobInstructionItems(ownJobId), notAuthorized);
assert.deepEqual(await toggleJobInstructionItemCompletion({ itemId: ownItemId }), notAuthorized);
assert.deepEqual(
  await updateJobInstructionItemContent({ itemId: ownItemId, content: 'Geändert' }),
  notAuthorized,
);
assert.deepEqual(await itemDetails(ownItemId), notAuthorized);
// The employee's parked jobs are only those they are assigned to.
assert.deepEqual(await getParkedJobs(), { success: true, jobs: [] });

// A Büro manager of organization A reaches no client, member, project, job or item of organization B.
signInAs(world, 'buero');
assert.deepEqual(await getJobsForClient(foreignClientId), relatedNothing);
assert.deepEqual(await getJobsForMember(foreignUserId), relatedNothing);
assert.deepEqual(await getProjectInstructionItems(foreignProjectId), {
  success: false,
  error: 'project_not_found',
});
assert.deepEqual(await createProjectInstructionItem({ projectId: foreignProjectId, content: 'Prüfen' }), {
  success: false,
  error: 'project_not_found',
});
assert.deepEqual(await getJobInstructionItems(foreignJobId), { success: false, error: 'job_not_found' });
const itemNotFound = { success: false, error: 'item_not_found' };
assert.deepEqual(
  await updateJobInstructionItemContent({ itemId: foreignItemId, content: 'Geändert' }),
  itemNotFound,
);
assert.deepEqual(await toggleJobInstructionItemCompletion({ itemId: foreignItemId }), itemNotFound);
assert.deepEqual(await itemDetails(foreignItemId), itemNotFound);
assert.equal(world.rpcCalls.length, 0);

// The parked list of organization A never shows organization B's parked job.
assert.deepEqual(await getParkedJobs(), { success: true, jobs: [] });

// The job number is generated for the caller's organization.
world.rpc = () => ({ data: 'AUF-2026-001', error: null });
assert.deepEqual(await getNextJobNumber(), { success: true, jobNumber: 'AUF-2026-001' });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_org_id]),
  [['generate_job_number', ORGANIZATION_A]],
);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
