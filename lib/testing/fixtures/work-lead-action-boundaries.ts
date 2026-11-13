// The „Projektleitung“'s review over the in-memory database: a lead reviews a
// Regie- oder Änderungsnachweis of the work they lead, as the database's lead
// rule (work_lead_scope) answers, and reads its Arbeitsnachweise without
// writing them. An employee who is not the lead and the lead of another
// project are refused before any write, and a failed lead rule is a load
// failure. supabase/tests/work_leads.sql proves the rule and the database's
// own refusals.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { databaseSnapshot } from './workforce-boundary-support';

const projectA = '8c000000-0000-4000-8000-000000000001';
const projectB = '8c000000-0000-4000-8000-000000000002';
const jobA1 = '8c000000-0000-4000-8000-000000000004';
const changeRecord = '8c000000-0000-4000-8000-000000000005';
const changeRevision = '8c000000-0000-4000-8000-000000000006';
const authorId = '8c000000-0000-4000-8000-000000000007';
const newId = '8c000000-0000-4000-8000-000000000009';
const siteDiary = '8c000000-0000-4000-8000-00000000000b';
const siteDiaryRevision = '8c000000-0000-4000-8000-00000000000c';

/** The rows work_lead_scope answers for the caller: what they lead now. */
let leadScope: Array<{ project_id: string | null; job_id: string | null }> = [];

const world = installActionWorld({
  projects: [
    { id: projectA, organization_id: ORGANIZATION_A, name: 'Neubau Lindenstraße', project_number: 'PRJ-1' },
    { id: projectB, organization_id: ORGANIZATION_A, name: 'Sanierung Ahornweg', project_number: 'PRJ-2' },
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
  work_artifacts: [
    {
      id: changeRecord,
      organization_id: ORGANIZATION_A,
      job_id: jobA1,
      project_id: null,
      kind: 'change_work',
    },
    { id: siteDiary, organization_id: ORGANIZATION_A, job_id: jobA1, project_id: null, kind: 'site_diary' },
  ],
  work_artifact_revisions: [
    { id: changeRevision, organization_id: ORGANIZATION_A, artifact_id: changeRecord, created_by: authorId },
    { id: siteDiaryRevision, organization_id: ORGANIZATION_A, artifact_id: siteDiary, created_by: authorId },
  ],
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: authorId, role: 'employee' },
  ],
  organization_responsibility_configurations: [],
  organization_responsibility_assignments: [],
  organization_responsibility_delegations: [],
  employee_records: [],
  profiles: [],
});

world.rpc = ({ name }) => {
  if (name === 'read_work_lead_scope') return { data: structuredClone(leadScope), error: null };
  if (name === 'record_work_artifact_action')
    return { data: { version: 2, status: 'approved' }, error: null };
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { getWorkArtifactDetail, getWorkArtifacts, recordWorkArtifactAction, saveWorkArtifact } = await import(
  '@/lib/work-artifacts/actions'
);

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const approve = (artifactId: string, revisionId: string) =>
  recordWorkArtifactAction({
    artifactId,
    revisionId,
    actionId: newId,
    expectedVersion: 1,
    actionType: 'internal_approved',
  });
const writes = () => world.rpcCalls.filter((call) => call.name !== 'read_work_lead_scope');

// An employee who is not the lead, and the lead of project B, review and read
// nothing in project A; nothing is written.
signInAs(world, 'employee');
const jobTarget = { targetType: 'job', targetId: jobA1 } as const;
for (const scope of [[], [{ project_id: projectB, job_id: null }]]) {
  leadScope = scope;
  assert.deepEqual(await approve(changeRecord, changeRevision), { success: false, error: 'not_responsible' });
  assert.deepEqual(await getWorkArtifacts(jobTarget), notAuthorized);
  assert.deepEqual(await getWorkArtifactDetail(changeRecord), notAuthorized);
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

// The lead reads the job's Arbeitsnachweise, may review the Regienachweis and
// writes no new one.
const detail = await getWorkArtifactDetail(changeRecord);
assert.ok(detail.success, JSON.stringify(detail));
assert.deepEqual([detail.artifact.canLeadReview, detail.artifact.leadReadOnly], [true, true]);
assert.equal((await getWorkArtifacts(jobTarget)).success, true);
world.rpcCalls.length = 0;
assert.deepEqual(
  await saveWorkArtifact({
    artifactId: newId,
    revisionId: newId,
    expectedVersion: null,
    targetType: 'job',
    targetId: jobA1,
    kind: 'change_work',
    visibility: 'internal_only',
    capturedAt: '2026-10-20T10:00:00+02:00',
    title: 'Regienachweis',
    content: { changeDescription: 'Mehr', changeReason: 'Wunsch', requestedByContext: 'Kundin' },
    submit: false,
  }),
  notAuthorized,
);
assert.deepEqual(writes(), [], 'the lead wrote a revision');

// A failed lead rule is a failure, never access and never a refusal.
world.rpc = ({ name }) =>
  name === 'read_work_lead_scope'
    ? { data: null, error: { code: '08006', message: 'connection failure' } }
    : { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
world.rpcCalls.length = 0;
assert.deepEqual(await getWorkArtifacts(jobTarget), { success: false, error: 'load_failed' });
assert.deepEqual(await approve(changeRecord, changeRevision), { success: false, error: 'load_failed' });
assert.deepEqual(writes(), []);
