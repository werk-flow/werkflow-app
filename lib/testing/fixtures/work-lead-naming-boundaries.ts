// Naming a „Projektleitung“ and the lead's view of a project over the
// in-memory database. Only Admin and Büro name, end and read the holdings;
// an employee who is not the lead, the lead of another project and a foreign
// organization's project get nothing, and a write always carries the caller's
// own organization and identity. The lead's overview holds the jobs the
// database's lead rule (read_work_lead_scope) names, in an allow-listed
// projection without a price, cost, billable flag, recipient or customer.
// supabase/tests/work_leads.sql proves the database functions' own refusals.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const projectA = '8d000000-0000-4000-8000-000000000001';
const projectB = '8d000000-0000-4000-8000-000000000002';
const foreignProject = '8d000000-0000-4000-8000-000000000003';
const jobA1 = '8d000000-0000-4000-8000-000000000004';
const jobA2 = '8d000000-0000-4000-8000-000000000005';
const memberId = '8d000000-0000-4000-8000-000000000006';
const memberRecord = '8d000000-0000-4000-8000-000000000007';
const holding = '8d000000-0000-4000-8000-000000000008';
const foreignHolding = '8d000000-0000-4000-8000-000000000009';

/** What read_work_lead_scope answers for the caller. */
let leadScope: { projectIds: string[]; jobIds: string[] } | null = { projectIds: [], jobIds: [] };

const world = installActionWorld({
  projects: [
    { id: projectA, organization_id: ORGANIZATION_A, name: 'Neubau Lindenstraße', project_number: 'PRJ-1' },
    { id: projectB, organization_id: ORGANIZATION_A, name: 'Sanierung Ahornweg', project_number: 'PRJ-2' },
    { id: foreignProject, organization_id: ORGANIZATION_B, name: 'Fremdes Projekt', project_number: 'PRJ-9' },
  ],
  jobs: [
    {
      id: jobA1,
      organization_id: ORGANIZATION_A,
      project_id: projectA,
      job_number: 'AUF-1',
      title: 'Heizung',
      description: 'Heizkörper tauschen',
      execution_state: 'in_progress',
      planned_date: '2026-11-20',
      // Office facts the lead's projection must leave out.
      client_id: '8d000000-0000-4000-8000-0000000000c1',
      is_billable: true,
      price_cents: 120000,
    },
    {
      id: jobA2,
      organization_id: ORGANIZATION_A,
      project_id: projectA,
      job_number: 'AUF-2',
      title: 'Sanitär',
      description: null,
      execution_state: 'not_started',
      planned_date: null,
    },
  ],
  job_instruction_items: [
    {
      id: '8d000000-0000-4000-8000-0000000000a1',
      organization_id: ORGANIZATION_A,
      job_id: jobA1,
      content: 'Alte Heizkörper entsorgen',
      requirement_state: 'required',
      is_completed: false,
      sort_order: 1,
    },
  ],
  job_assignments: [],
  work_artifacts: [],
  work_artifact_revisions: [],
  work_leads: [
    {
      id: holding,
      organization_id: ORGANIZATION_A,
      project_id: projectA,
      job_id: null,
      employee_record_id: memberRecord,
      started_at: '2026-11-01T08:00:00Z',
      started_by: CALLER_ID,
      ended_at: null,
      ended_by: null,
    },
    {
      id: foreignHolding,
      organization_id: ORGANIZATION_B,
      project_id: projectA,
      job_id: null,
      employee_record_id: memberRecord,
      started_at: '2026-11-02T08:00:00Z',
      started_by: null,
      ended_at: null,
      ended_by: null,
    },
  ],
  employee_records: [
    {
      id: memberRecord,
      organization_id: ORGANIZATION_A,
      user_id: memberId,
      first_name: 'Erika',
      last_name: 'Musterfrau',
    },
  ],
  profiles: [{ id: CALLER_ID, first_name: 'Max', last_name: 'Mustermann' }],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: memberId, role: 'employee' },
  ],
  organization_responsibility_configurations: [],
  organization_responsibility_assignments: [],
  organization_responsibility_delegations: [],
});

/** The database functions' answers: a target outside the caller's organization is not found. */
world.rpc = ({ name, args }) => {
  if (name === 'read_work_lead_scope') {
    return leadScope
      ? { data: structuredClone(leadScope), error: null }
      : { data: null, error: { code: '08006', message: 'connection failure' } };
  }
  if (name === 'name_work_lead' || name === 'end_work_lead') {
    const inOrganization = world.tables.projects?.some(
      (project) => project.id === args.p_project_id && project.organization_id === args.p_organization_id,
    );
    return inOrganization
      ? { data: { leadId: holding, changed: true }, error: null }
      : { data: null, error: { code: 'P0001', message: 'work_lead_target_not_found' } };
  }
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { endWorkLead, nameWorkLead } = await import('@/lib/projects/work-lead-actions');
const { getLedProjectOverview, getWorkLead } = await import('@/lib/projects/work-lead-reads');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const writes = () => world.rpcCalls.filter((call) => call.name !== 'read_work_lead_scope');
const name = (targetId: string) =>
  nameWorkLead({ targetType: 'project', targetId, userId: memberId, expectedLeadId: holding });
const end = (targetId: string) => endWorkLead({ targetType: 'project', targetId, expectedLeadId: holding });

// An employee who is not the lead, and the lead of project B, name, end and
// read no holding of project A, and read no overview of it.
signInAs(world, 'employee');
for (const scope of [
  { projectIds: [], jobIds: [] },
  { projectIds: [projectB], jobIds: [] },
]) {
  leadScope = scope;
  assert.deepEqual(await name(projectA), notAuthorized);
  assert.deepEqual(await end(projectA), notAuthorized);
  assert.deepEqual(await getWorkLead({ targetType: 'project', targetId: projectA }), notAuthorized);
  assert.deepEqual(await getLedProjectOverview('PRJ-1'), notAuthorized);
}
// Even the lead of project A names and ends no lead: naming is the office's.
leadScope = { projectIds: [projectA], jobIds: [jobA1] };
assert.deepEqual(await name(projectA), notAuthorized);
assert.deepEqual(await end(projectA), notAuthorized);
assert.deepEqual(writes(), [], 'a refused naming wrote');
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');

// The lead of project A reads its jobs in the scope, in the lead's projection.
// Job A2 names its own lead, so the rule leaves it out.
const overview = await getLedProjectOverview('PRJ-1');
assert.ok(overview.success, JSON.stringify(overview));
assert.deepEqual(
  overview.overview.jobs.map((job) => job.id),
  [jobA1],
);
assert.deepEqual(overview.overview.jobs[0]?.instructions, [
  {
    id: '8d000000-0000-4000-8000-0000000000a1',
    content: 'Alte Heizkörper entsorgen',
    required: true,
    completed: false,
  },
]);
const keys = JSON.stringify(overview.overview).match(/"[A-Za-z_]+":/g) ?? [];
assert.deepEqual(
  keys.filter((key) => /price|cost|billable|recipient|client|customer|amount/i.test(key)),
  [],
  'the lead reads a commercial fact',
);
// A foreign organization's project number is no project of the caller's organization.
leadScope = { projectIds: [foreignProject], jobIds: [] };
assert.deepEqual(await getLedProjectOverview('PRJ-9'), notAuthorized);
// A rule that cannot be read is a failure, never access and never a refusal.
leadScope = null;
assert.deepEqual(await getLedProjectOverview('PRJ-1'), { success: false, error: 'load_failed' });

// Büro reads the organization's holdings of project A only, never a foreign one.
signInAs(world, 'buero');
const panel = await getWorkLead({ targetType: 'project', targetId: projectA });
assert.ok(panel.success, JSON.stringify(panel));
assert.deepEqual(
  panel.panel.history.map((entry) => [entry.id, entry.name, entry.startedByName]),
  [[holding, 'Erika Musterfrau', 'Max Mustermann']],
);
assert.equal(panel.panel.current?.id, holding);

// Büro names and ends with the caller's own organization and identity; a
// foreign organization's project is refused by the database as not found.
world.rpcCalls.length = 0;
assert.deepEqual(await name(foreignProject), { success: false, error: 'work_lead_target_not_found' });
assert.deepEqual(await end(foreignProject), { success: false, error: 'work_lead_target_not_found' });
assert.deepEqual(await name(projectA), { success: true });
assert.deepEqual(await end(projectA), { success: true });
assert.deepEqual(
  writes().map((call) => [
    call.name,
    call.args.p_organization_id,
    call.args.p_actor_id,
    call.args.p_project_id,
  ]),
  [
    ['name_work_lead', ORGANIZATION_A, CALLER_ID, foreignProject],
    ['end_work_lead', ORGANIZATION_A, CALLER_ID, foreignProject],
    ['name_work_lead', ORGANIZATION_A, CALLER_ID, projectA],
    ['end_work_lead', ORGANIZATION_A, CALLER_ID, projectA],
  ],
);
assert.deepEqual(writes()[2]?.args, {
  p_organization_id: ORGANIZATION_A,
  p_actor_id: CALLER_ID,
  p_project_id: projectA,
  p_job_id: null,
  p_lead_user_id: memberId,
  p_expected_lead_id: holding,
});

// The database's refusals reach the office by name; its own manager check is a refusal.
for (const [message, error] of [
  ['work_lead_changed', 'work_lead_changed'],
  ['work_lead_member_not_eligible', 'work_lead_member_not_eligible'],
  ['work_lead_not_authorized', 'not_authorized'],
] as const) {
  world.rpc = () => ({ data: null, error: { code: 'P0001', message } });
  assert.deepEqual(await name(projectA), { success: false, error });
}
// A transport failure is a failed save, never a refusal.
world.rpc = () => ({ data: null, error: { code: '08006', message: 'connection failure' } });
assert.deepEqual(await end(projectA), { success: false, error: 'save_failed' });
// A malformed id never reaches the database.
world.rpcCalls.length = 0;
assert.deepEqual(
  await nameWorkLead({ targetType: 'project', targetId: 'PRJ-1', userId: memberId, expectedLeadId: null }),
  { success: false, error: 'invalid_input' },
);
assert.deepEqual(world.rpcCalls, []);
