// Actual instruction list actions over the in-memory database: only managers
// change a list, a list of another organization is unreachable, and every
// change is one database function call for the caller's organization, which
// applies completely or not at all (supabase/tests/work_atomic_writes.sql).
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const jobId = '90000000-0000-4000-8000-000000000101';
const foreignJobId = '90000000-0000-4000-8000-000000000109';
const projectId = '90000000-0000-4000-8000-000000000201';
const foreignProjectId = '90000000-0000-4000-8000-000000000209';
const itemIds = ['90000000-0000-4000-8000-000000000301', '90000000-0000-4000-8000-000000000302'];
const foreignItemId = '90000000-0000-4000-8000-000000000309';
const now = '2026-10-01T08:00:00.000Z';

const itemRow = (
  id: string,
  organizationId: string,
  owner: { job_id: string | null; project_id: string | null },
  sortOrder: number,
): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  ...owner,
  content: 'Schritt',
  sort_order: sortOrder,
  is_completed: false,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
});

const world = installActionWorld({
  jobs: [
    { id: jobId, organization_id: ORGANIZATION_A },
    { id: foreignJobId, organization_id: ORGANIZATION_B },
  ],
  projects: [
    { id: projectId, organization_id: ORGANIZATION_A },
    { id: foreignProjectId, organization_id: ORGANIZATION_B },
  ],
  job_assignments: [{ organization_id: ORGANIZATION_A, job_id: jobId, user_id: CALLER_ID, id: 'assignment' }],
  job_instruction_items: [
    itemRow(itemIds[0] ?? '', ORGANIZATION_A, { job_id: jobId, project_id: null }, 0),
    itemRow(itemIds[1] ?? '', ORGANIZATION_A, { job_id: jobId, project_id: null }, 1),
    itemRow(foreignItemId, ORGANIZATION_B, { job_id: foreignJobId, project_id: null }, 0),
  ],
});
const actions = await import('@/lib/jobs/instruction-items-actions');
const reversed = [...itemIds].reverse();

// A field worker assigned to the job still cannot change its list.
signInAs(world, 'employee');
assert.deepEqual(await actions.reorderJobInstructionItems({ jobId, itemIds: reversed }), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.createJobInstructionItem({ jobId, content: 'Neu' }), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.deleteJobInstructionItem({ itemId: itemIds[0] ?? '' }), {
  success: false,
  error: 'not_authorized',
});

// A manager never reaches a list, a project or an item of another organization.
signInAs(world, 'buero');
assert.deepEqual(
  await actions.reorderJobInstructionItems({ jobId: foreignJobId, itemIds: [foreignItemId] }),
  {
    success: false,
    error: 'job_not_found',
  },
);
assert.deepEqual(
  await actions.reorderProjectInstructionItems({ projectId: foreignProjectId, itemIds: [foreignItemId] }),
  { success: false, error: 'project_not_found' },
);
assert.deepEqual(await actions.createJobInstructionItem({ jobId: foreignJobId, content: 'Neu' }), {
  success: false,
  error: 'job_not_found',
});
assert.deepEqual(await actions.deleteJobInstructionItem({ itemId: foreignItemId }), {
  success: false,
  error: 'item_not_found',
});
assert.deepEqual(world.rpcCalls, [], 'a refused caller reaches no database function');

// Each change is one function call for the caller's organization and the verified list.
assert.deepEqual(await actions.reorderJobInstructionItems({ jobId, itemIds: reversed }), { success: true });
assert.deepEqual(await actions.reorderProjectInstructionItems({ projectId, itemIds: [] }), { success: true });
assert.deepEqual(await actions.deleteJobInstructionItem({ itemId: itemIds[0] ?? '' }), { success: true });
assert.deepEqual(world.rpcCalls, [
  {
    name: 'reorder_instruction_items',
    args: { p_organization_id: ORGANIZATION_A, p_job_id: jobId, p_project_id: null, p_item_ids: reversed },
  },
  {
    name: 'reorder_instruction_items',
    args: { p_organization_id: ORGANIZATION_A, p_job_id: null, p_project_id: projectId, p_item_ids: [] },
  },
  {
    name: 'delete_instruction_item',
    args: { p_organization_id: ORGANIZATION_A, p_item_id: itemIds[0] },
  },
]);

// A refusal the function names keeps its code; any other failure is the action's fallback.
world.rpc = () => ({ data: null, error: { message: 'invalid_reorder' } });
assert.deepEqual(await actions.reorderJobInstructionItems({ jobId, itemIds: [itemIds[0] ?? ''] }), {
  success: false,
  error: 'invalid_reorder',
});
world.rpc = () => ({ data: null, error: { message: 'item_not_found' } });
assert.deepEqual(
  await actions.createJobInstructionItem({ jobId, content: ' Neu ', afterItemId: foreignItemId }),
  {
    success: false,
    error: 'item_not_found',
  },
);
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'create_job_instruction_item',
  args: {
    p_organization_id: ORGANIZATION_A,
    p_job_id: jobId,
    p_actor_id: CALLER_ID,
    p_content: 'Neu',
    p_after_item_id: foreignItemId,
  },
});
world.rpc = () => ({ data: null, error: { message: 'foreign key violation' } });
assert.deepEqual(await actions.reorderJobInstructionItems({ jobId, itemIds: reversed }), {
  success: false,
  error: 'reorder_failed',
});
assert.deepEqual(await actions.deleteJobInstructionItem({ itemId: itemIds[1] ?? '' }), {
  success: false,
  error: 'delete_failed',
});
