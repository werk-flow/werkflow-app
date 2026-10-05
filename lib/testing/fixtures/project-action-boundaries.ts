// Actual Projekt actions over the in-memory database: only managers write,
// a field worker reads a project only through an assigned job, and a project
// of another organization is unreachable by id and by number.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const projectId = '90000000-0000-4000-8000-000000000001';
const unassignedProjectId = '90000000-0000-4000-8000-000000000002';
const foreignProjectId = '90000000-0000-4000-8000-000000000009';
const clientId = '70000000-0000-4000-8000-000000000001';
const secondClientId = '70000000-0000-4000-8000-000000000002';
const foreignClientId = '70000000-0000-4000-8000-000000000009';
const siteId = '80000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';

const projectRow = (
  id: string,
  organizationId: string,
  projectNumber: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  project_number: projectNumber,
  name: 'Badsanierung',
  description: null,
  client_id: null,
  site_id: null,
  contact_id: null,
  planned_start_date: null,
  planned_end_date: null,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
  ...overrides,
});
const jobRow = (
  id: string,
  organizationId: string,
  jobProjectId: string,
  jobClientId: string | null,
): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  project_id: jobProjectId,
  client_id: jobClientId,
  site_id: siteId,
  contact_id: null,
  title: 'Rohinstallation',
  status: 'geplant',
  priority: 'mittel',
  planned_date: null,
  created_at: now,
  updated_at: now,
});

const world = installActionWorld(
  {
    projects: [
      projectRow(projectId, ORGANIZATION_A, 'P/2026 001', { client_id: clientId, site_id: siteId }),
      projectRow(unassignedProjectId, ORGANIZATION_A, 'P-2026-002'),
      projectRow(foreignProjectId, ORGANIZATION_B, 'P-2026-900', { client_id: foreignClientId }),
    ],
    clients: [
      {
        id: clientId,
        organization_id: ORGANIZATION_A,
        name: 'Bestandskunde',
        client_type: 'privat',
        created_at: now,
        updated_at: now,
      },
      {
        id: secondClientId,
        organization_id: ORGANIZATION_A,
        name: 'Zweiter Kunde',
        client_type: 'privat',
        created_at: now,
        updated_at: now,
      },
      {
        id: foreignClientId,
        organization_id: ORGANIZATION_B,
        name: 'Fremder Kunde',
        client_type: 'privat',
        created_at: now,
        updated_at: now,
      },
    ],
    client_sites: [{ id: siteId, organization_id: ORGANIZATION_A, client_id: clientId }],
    client_contacts: [],
    jobs: [
      jobRow('job-in-project', ORGANIZATION_A, projectId, clientId),
      jobRow('job-elsewhere', ORGANIZATION_A, unassignedProjectId, clientId),
      jobRow('job-foreign', ORGANIZATION_B, foreignProjectId, foreignClientId),
    ],
    // The in-memory database has no joins: the embedded filter column of the
    // access check (`jobs.project_id`) is stored on the assignment row itself.
    job_assignments: [{ user_id: CALLER_ID, job_id: 'job-in-project', 'jobs.project_id': projectId }],
  },
  { projects: () => ({ created_at: now, updated_at: now }) },
);
const actions = await import('@/lib/projects/actions');

const projectById = (id: string): Record<string, unknown> | undefined =>
  tableRows(world, 'projects').find((project) => project.id === id);
const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();
const validProject = { name: 'Heizungstausch', projectNumber: 'P-2026-010' };

// Signed-out callers and callers without an organization are denied by every action.
const everyAction = (): Array<Promise<{ success: boolean; error?: string }>> => [
  actions.createProject(validProject),
  actions.updateProject(projectId, { name: 'Neu' }),
  actions.deleteProject(projectId),
  actions.getProjectDetails(projectId),
  actions.getProjectByNumber('P-2026-002'),
  actions.getNextProjectNumber(),
];
world.callerId = null;
for (const result of await Promise.all(everyAction()))
  assert.deepEqual(result, { success: false, error: 'not_authenticated' });
signInAs(world, null);
for (const result of await Promise.all(everyAction()))
  assert.deepEqual(result, { success: false, error: 'no_active_org' });
assert.equal(world.adminClientRequests, 0);

// A field worker cannot write, and is refused before the database is touched.
signInAs(world, 'employee');
assert.deepEqual(await actions.createProject(validProject), { success: false, error: 'not_authorized' });
assert.deepEqual(await actions.updateProject(projectId, { name: 'Neu' }), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.deleteProject(projectId), { success: false, error: 'not_authorized' });
assert.equal(world.adminClientRequests, 0);

// A field worker reads a project only when one of its jobs is assigned to them.
const assignedDetails = await actions.getProjectDetails(projectId);
assert.ok(assignedDetails.success);
assert.deepEqual(
  assignedDetails.details.jobs.map((job) => job.id),
  ['job-in-project'],
);
assert.equal(assignedDetails.details.client?.id, clientId);
assert.deepEqual(await actions.getProjectDetails(unassignedProjectId), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await actions.getProjectByNumber('P-2026-002'), { success: false, error: 'not_authorized' });
assert.deepEqual(await actions.getProjectDetails(foreignProjectId), {
  success: false,
  error: 'project_not_found',
});

// A manager reaches own projects by id and by URL-encoded number, never another organization's.
signInAs(world, 'buero');
const byNumber = await actions.getProjectByNumber(encodeURIComponent('P/2026 001'));
assert.ok(byNumber.success);
assert.equal(byNumber.details.project.id, projectId);
assert.deepEqual(await actions.getProjectDetails(foreignProjectId), {
  success: false,
  error: 'project_not_found',
});
assert.deepEqual(await actions.getProjectByNumber('P-2026-900'), {
  success: false,
  error: 'project_not_found',
});
assert.deepEqual(await actions.updateProject(foreignProjectId, { name: 'Übernommen' }), {
  success: false,
  error: 'project_not_found',
});
assert.deepEqual(await actions.deleteProject(foreignProjectId), {
  success: false,
  error: 'project_not_found',
});

// Edits reject bad input and foreign references without writing.
assert.deepEqual(await actions.createProject({ ...validProject, clientId: 'not-a-uuid' }), {
  success: false,
  error: 'invalid_input',
});
assert.deepEqual(await actions.updateProject(projectId, {}), { success: false, error: 'no_changes' });
assert.deepEqual(await actions.updateProject(projectId, { name: ' ' }), {
  success: false,
  error: 'name_or_description_required',
});
assert.deepEqual(await actions.updateProject(projectId, { projectNumber: 'P-2026-002' }), {
  success: false,
  error: 'project_number_taken',
});
assert.deepEqual(await actions.updateProject(projectId, { clientId: foreignClientId }), {
  success: false,
  error: 'client_not_found',
});
assert.equal(databaseSnapshot(), initialDatabase, 'no denied or rejected call may write');
assert.deepEqual(world.rpcCalls, []);

// Creating is one database call for the caller's organization with the trimmed
// columns; the function checks the number and the references under lock and
// writes the template in the same transaction (supabase/tests/work_creation_writes.sql).
const createdProject = projectRow('90000000-0000-4000-8000-000000000003', ORGANIZATION_A, 'P-2026-900', {
  client_id: clientId,
  site_id: siteId,
});
world.rpc = () => ({ data: createdProject, error: null });
const created = await actions.createProject({
  name: '  Heizungstausch ',
  projectNumber: ' P-2026-900 ',
  clientId,
  siteId,
});
assert.ok(created.success);
assert.equal(created.project.id, createdProject.id);
assert.deepEqual(world.rpcCalls, [
  {
    name: 'create_project_with_template',
    args: {
      p_organization_id: ORGANIZATION_A,
      p_actor_id: CALLER_ID,
      p_project: {
        name: 'Heizungstausch',
        description: null,
        client_id: clientId,
        site_id: siteId,
        contact_id: null,
        project_number: 'P-2026-900',
        planned_start_date: null,
        planned_end_date: null,
      },
      p_template_version_id: null,
    },
  },
]);
// A refusal the function names keeps its code; any other failure is create_failed.
for (const refusal of [
  'name_or_description_required',
  'project_number_required',
  'project_number_taken',
  'client_not_found',
  'site_client_mismatch',
  'work_template_version_unavailable',
]) {
  world.rpc = () => ({ data: null, error: { message: refusal } });
  assert.deepEqual(await actions.createProject(validProject), { success: false, error: refusal });
}
world.rpc = () => ({ data: null, error: { message: 'wf_refused' } });
assert.deepEqual(await actions.createProject(validProject), { success: false, error: 'create_failed' });
world.rpcCalls.length = 0;

// Changing the customer is one database call for the caller's organization: the
// project drops the previous customer's site and contact, and the function moves
// the project's jobs in the same transaction (supabase/tests/work_atomic_writes.sql).
const savedProject = projectRow(projectId, ORGANIZATION_A, 'P/2026 001', { client_id: secondClientId });
world.rpc = () => ({ data: savedProject, error: null });
const updated = await actions.updateProject(projectId, { clientId: secondClientId });
assert.ok(updated.success);
assert.equal(updated.project.clientId, secondClientId);
assert.deepEqual(world.rpcCalls, [
  {
    name: 'update_project_with_jobs',
    args: {
      p_organization_id: ORGANIZATION_A,
      p_project_id: projectId,
      p_changes: { client_id: secondClientId, site_id: null, contact_id: null },
    },
  },
]);
// A refusal the function names keeps its code; any other failure is update_failed.
world.rpc = () => ({ data: null, error: { message: 'site_client_mismatch' } });
assert.deepEqual(await actions.updateProject(projectId, { clientId: secondClientId }), {
  success: false,
  error: 'site_client_mismatch',
});
world.rpc = () => ({ data: null, error: { message: 'wf_refused' } });
assert.deepEqual(await actions.updateProject(projectId, { clientId: secondClientId }), {
  success: false,
  error: 'update_failed',
});
world.rpcCalls.length = 0;

// Deleting removes exactly the named project.
assert.deepEqual(await actions.deleteProject(unassignedProjectId), { success: true });
assert.equal(projectById(unassignedProjectId), undefined);
assert.deepEqual(
  projectById(foreignProjectId),
  projectRow(foreignProjectId, ORGANIZATION_B, 'P-2026-900', { client_id: foreignClientId }),
);

// The number generator is asked for the caller's organization; a database failure is a stable code.
world.rpc = () => ({ data: 'P-2026-011', error: null });
assert.deepEqual(await actions.getNextProjectNumber(), { success: true, projectNumber: 'P-2026-011' });
assert.deepEqual(world.rpcCalls, [{ name: 'generate_project_number', args: { p_org_id: ORGANIZATION_A } }]);
world.rpc = () => ({ data: null, error: { message: 'sequence unavailable' } });
assert.deepEqual(await actions.getNextProjectNumber(), { success: false, error: 'generation_failed' });
