// The actual instruction list readers over the in-memory database: a person who
// has left the organization is still named on the items they created or ticked,
// but the reader gets neither their current email nor their avatar path. A
// current member keeps the full reference. A list of another organization stays
// unreachable, and a failed membership read fails the list instead of exposing
// the person.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const formerMemberId = '30000000-0000-4000-8000-000000000002';
const jobId = '91000000-0000-4000-8000-000000000101';
const foreignJobId = '91000000-0000-4000-8000-000000000109';
const projectId = '91000000-0000-4000-8000-000000000201';
const foreignProjectId = '91000000-0000-4000-8000-000000000209';
const now = '2026-10-01T08:00:00.000Z';

const itemRow = (
  id: string,
  organizationId: string,
  owner: { job_id: string | null; project_id: string | null },
  people: { created_by: string; last_status_changed_by: string | null },
): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  ...owner,
  ...people,
  content: 'Schritt',
  item_kind: 'task',
  requirement_state: 'required',
  group_label: null,
  notes: null,
  work_template_application_id: null,
  source_work_template_item_id: null,
  sort_order: 0,
  is_completed: people.last_status_changed_by !== null,
  completion_version: 0,
  last_status_changed_at: people.last_status_changed_by === null ? null : now,
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
  // The former member left organization A and now works for organization B.
  organization_members: [
    { id: 'member-caller', organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' },
    { id: 'member-elsewhere', organization_id: ORGANIZATION_B, user_id: formerMemberId, role: 'employee' },
  ],
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Bea',
      last_name: 'Büro',
      email: 'bea@example.test',
      avatar_path: 'avatars/bea.png',
    },
    {
      id: formerMemberId,
      first_name: 'Erik',
      last_name: 'Ehemalig',
      email: 'erik.neu@example.test',
      avatar_path: 'avatars/erik.png',
    },
  ],
  job_instruction_items: [
    itemRow(
      '91000000-0000-4000-8000-000000000301',
      ORGANIZATION_A,
      { job_id: jobId, project_id: null },
      { created_by: formerMemberId, last_status_changed_by: CALLER_ID },
    ),
    itemRow(
      '91000000-0000-4000-8000-000000000302',
      ORGANIZATION_A,
      { job_id: null, project_id: projectId },
      { created_by: CALLER_ID, last_status_changed_by: formerMemberId },
    ),
    itemRow(
      '91000000-0000-4000-8000-000000000309',
      ORGANIZATION_B,
      { job_id: foreignJobId, project_id: null },
      { created_by: formerMemberId, last_status_changed_by: null },
    ),
  ],
});
const actions = await import('@/lib/jobs/instruction-items-actions');

const formerMember = {
  userId: formerMemberId,
  firstName: 'Erik',
  lastName: 'Ehemalig',
  email: null,
  avatarPath: null,
};
const currentMember = {
  userId: CALLER_ID,
  firstName: 'Bea',
  lastName: 'Büro',
  email: 'bea@example.test',
  avatarPath: 'avatars/bea.png',
};

signInAs(world, 'buero');

// A job list names the former creator without their current email or avatar.
const jobList = await actions.getJobInstructionItems(jobId);
assert.equal(jobList.success, true, JSON.stringify(jobList));
assert.ok(jobList.success);
assert.deepEqual(
  jobList.items.map((item) => [item.creator, item.lastStatusChangedByProfile]),
  [[formerMember, currentMember]],
  'a former member keeps only the name; a current member keeps the full reference',
);

// The same holds for the person who last ticked a project item.
const projectList = await actions.getProjectInstructionItems(projectId);
assert.ok(projectList.success, JSON.stringify(projectList));
assert.deepEqual(
  projectList.items.map((item) => [item.creator, item.lastStatusChangedByProfile]),
  [[currentMember, formerMember]],
);

// A list of another organization is unknown, as before.
assert.deepEqual(await actions.getJobInstructionItems(foreignJobId), {
  success: false,
  error: 'job_not_found',
});
assert.deepEqual(await actions.getProjectInstructionItems(foreignProjectId), {
  success: false,
  error: 'project_not_found',
});

// Without the membership read the reader cannot tell who left, so the list fails.
world.failingTables.add('organization_members');
assert.deepEqual(await actions.getJobInstructionItems(jobId), { success: false, error: 'fetch_failed' });
