// The „Projektleitung“ actions over the in-memory database: only Admin and
// Büro name, end or read a lead, and only a member of their own organization;
// the database function receives the caller's organization and refuses a
// foreign project. A lead reviews a Regie- oder Änderungsnachweis of the work
// they lead, as the database's lead rule (work_lead_scope) answers; an
// employee who is not the lead and the lead of another project are refused
// before any write, and the lead's read of the project carries no price,
// cost, billable flag or recipient. supabase/tests/work_leads.sql proves the
// rule and the functions themselves.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertCallerScopedCalls, databaseSnapshot } from './workforce-boundary-support';

const projectA = '8c000000-0000-4000-8000-000000000001';
const projectB = '8c000000-0000-4000-8000-000000000002';
const foreignProject = '8c000000-0000-4000-8000-000000000003';
const jobA1 = '8c000000-0000-4000-8000-000000000004';
const changeRecord = '8c000000-0000-4000-8000-000000000005';
const changeRevision = '8c000000-0000-4000-8000-000000000006';
const authorId = '8c000000-0000-4000-8000-000000000007';
const foreignMemberId = '8c000000-0000-4000-8000-000000000008';
const newId = '8c000000-0000-4000-8000-000000000009';
const memberId = '8c000000-0000-4000-8000-00000000000a';
const siteDiary = '8c000000-0000-4000-8000-00000000000b';
const siteDiaryRevision = '8c000000-0000-4000-8000-00000000000c';

/** The rows work_lead_scope answers for the caller: what they lead now. */
let leadScope: Array<{ project_id: string | null; job_id: string | null }> = [];

const world = installActionWorld({
  projects: [
    { id: projectA, organization_id: ORGANIZATION_A, name: 'Neubau Lindenstraße', project_number: 'PRJ-1' },
    { id: projectB, organization_id: ORGANIZATION_A, name: 'Sanierung Ahornweg', project_number: 'PRJ-2' },
    { id: foreignProject, organization_id: ORGANIZATION_B, name: 'Fremd', project_number: 'PRJ-3' },
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
    },
  ],
  job_assignments: [],
  job_instruction_items: [
    {
      id: newId,
      organization_id: ORGANIZATION_A,
      job_id: jobA1,
      content: 'Vorlauf prüfen',
      requirement_state: 'required',
      is_completed: false,
      sort_order: 1,
    },
  ],
  work_artifacts: [
    { id: changeRecord, organization_id: ORGANIZATION_A, job_id: jobA1, project_id: null, kind: 'change_work' },
    { id: siteDiary, organization_id: ORGANIZATION_A, job_id: jobA1, project_id: null, kind: 'site_diary' },
  ],
  work_artifact_revisions: [
    { id: changeRevision, organization_id: ORGANIZATION_A, artifact_id: changeRecord, created_by: authorId },
    { id: siteDiaryRevision, organization_id: ORGANIZATION_A, artifact_id: siteDiary, created_by: authorId },
  ],
  work_leads: [
    {
      id: newId,
      organization_id: ORGANIZATION_B,
      project_id: foreignProject,
      job_id: null,
      employee_record_id: foreignMemberId,
      started_at: '2026-11-01T08:00:00.000Z',
      started_by: null,
      ended_at: null,
      ended_by: null,
    },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: authorId, role: 'employee' },
    { organization_id: ORGANIZATION_B, user_id: foreignMemberId, role: 'employee' },
  ],
  organization_responsibility_configurations: [],
  organization_responsibility_assignments: [],
  organization_responsibility_delegations: [],
  employee_records: [],
  profiles: [],
});

world.rpc = ({ name, args }) => {
  if (name === 'work_lead_scope') return { data: structuredClone(leadScope), error: null };
  if (name === 'name_work_lead' || name === 'end_work_lead') {
    const project = (world.tables.projects ?? []).find(
      (row) => row.id === args.p_project_id && row.organization_id === args.p_organization_id,
    );
    return project
      ? { data: { leadId: newId, changed: true }, error: null }
      : { data: null, error: { code: 'P0001', message: 'work_lead_target_not_found' } };
  }
  if (name === 'record_work_artifact_action') return { data: { version: 2, status: 'approved' }, error: null };
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { endWorkLead, getWorkLead, nameWorkLead } = await import('@/lib/projects/work-lead-actions');
const { getLedProjectOverview } = await import('@/lib/projects/work-lead-reads');
const { recordWorkArtifactAction } = await import('@/lib/work-artifacts/actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const approve = (artifactId: string, revisionId: string) =>
  recordWorkArtifactAction({ artifactId, revisionId, actionId: newId, expectedVersion: 1, actionType: 'internal_approved' });
const writes = () => world.rpcCalls.filter((call) => call.name !== 'work_lead_scope');

// An employee names, ends and reads no lead.
signInAs(world, 'employee');
assert.deepEqual(await nameWorkLead({ targetType: 'project', targetId: projectA, userId: authorId }), notAuthorized);
assert.deepEqual(await endWorkLead({ targetType: 'project', targetId: projectA }), notAuthorized);
assert.deepEqual(await getWorkLead({ targetType: 'project', targetId: projectA }), notAuthorized);
assert.equal(world.rpcCalls.length, 0);

// An Admin of organization A names no member of organization B, gets no lead on
// organization B's project, and reads none of its holdings.
signInAs(world, 'admin');
world.tables.employee_records?.push(
  { id: newId, organization_id: ORGANIZATION_B, user_id: foreignMemberId, first_name: 'Fremda', last_name: 'B' },
  { id: memberId, organization_id: ORGANIZATION_A, user_id: authorId, first_name: 'Max', last_name: 'Muster' },
);
assert.deepEqual(
  await nameWorkLead({ targetType: 'project', targetId: projectA, userId: foreignMemberId }),
  { success: false, error: 'work_lead_member_not_eligible' },
);
assert.equal(world.rpcCalls.length, 0, 'a foreign member reached the database function');
assert.deepEqual(
  await nameWorkLead({ targetType: 'project', targetId: foreignProject, userId: authorId }),
  { success: false, error: 'work_lead_target_not_found' },
);
assert.deepEqual(await endWorkLead({ targetType: 'project', targetId: foreignProject }), {
  success: false,
  error: 'work_lead_target_not_found',
});
assertCallerScopedCalls(world);
const foreignPanel = await getWorkLead({ targetType: 'project', targetId: foreignProject });
assert.ok(foreignPanel.success);
assert.deepEqual(foreignPanel.panel.history, [], "organization B's holding reached organization A");
world.tables.employee_records = [];
world.rpcCalls.length = 0;

// An employee who is not the lead, and the lead of project B, review nothing in
// project A and read no overview of it; nothing is written.
signInAs(world, 'employee');
for (const scope of [[], [{ project_id: projectB, job_id: null }]]) {
  leadScope = scope;
  assert.deepEqual(await approve(changeRecord, changeRevision), { success: false, error: 'not_responsible' });
  assert.deepEqual(await getLedProjectOverview(projectA), notAuthorized);
}
// The lead of project A reviews no Bautagebuch.
leadScope = [
  { project_id: projectA, job_id: null },
  { project_id: projectA, job_id: jobA1 },
];
assert.deepEqual(await approve(siteDiary, siteDiaryRevision), { success: false, error: 'not_responsible' });
assert.deepEqual(writes(), [], 'a refused review wrote');
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');

// The lead of project A approves the job's Regienachweis, recorded as the lead.
assert.equal((await approve(changeRecord, changeRevision)).success, true);
const recorded = writes();
assert.equal(recorded.length, 1);
assert.equal(recorded[0]?.args.p_organization_id, ORGANIZATION_A);
assert.equal(recorded[0]?.args.p_actor_id, CALLER_ID);
assert.deepEqual(recorded[0]?.args.p_responsibility_snapshot, {
  responsibility: 'work_lead',
  target: { targetType: 'job', targetId: jobA1 },
});

// The lead's read of project A: scope, instructions and evidence, no commercial fact.
const overview = await getLedProjectOverview(projectA);
assert.ok(overview.success, JSON.stringify(overview));
assert.deepEqual(
  overview.overview.jobs.map((job) => [job.title, job.instructions.map((item) => item.content)]),
  [['Heizung', ['Vorlauf prüfen']]],
);
const commercialKey = /price|cost|billable|recipient|amount|margin|auftraggeber/i;
const keys = new Set<string>();
JSON.stringify(overview, (key, value: unknown) => {
  keys.add(key);
  return value;
});
assert.deepEqual([...keys].filter((key) => commercialKey.test(key)), [], 'the lead read a commercial field');

// A failed lead rule is a failure, never access and never a refusal.
world.rpc = ({ name }) =>
  name === 'work_lead_scope'
    ? { data: null, error: { code: '08006', message: 'connection failure' } }
    : { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
world.rpcCalls.length = 0;
assert.deepEqual(await getLedProjectOverview(projectA), { success: false, error: 'load_failed' });
assert.deepEqual(await approve(changeRecord, changeRevision), { success: false, error: 'load_failed' });
assert.deepEqual(writes(), []);
