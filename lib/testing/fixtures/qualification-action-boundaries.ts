// Actual qualification, team and requirement actions over the in-memory
// database: a field worker is refused before any database access, only an
// admin switches the apprentice warning, a job, project, team or employee of
// another organization is unreachable, and each write is one database call
// that names the caller's organization and the caller.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignJobId = '81000000-0000-4000-8000-000000000001';
const foreignProjectId = '81000000-0000-4000-8000-000000000002';
const foreignTeamId = '81000000-0000-4000-8000-000000000003';
const foreignEmployeeRecordId = '81000000-0000-4000-8000-000000000004';
const foreignMembershipId = '81000000-0000-4000-8000-000000000005';
const foreignCapabilityId = '81000000-0000-4000-8000-000000000006';
const foreignRecordId = '81000000-0000-4000-8000-000000000007';
const ownCapabilityId = '81000000-0000-4000-8000-000000000008';
const ownEmployeeRecordId = '81000000-0000-4000-8000-000000000009';

const world = installActionWorld({
  jobs: [{ id: foreignJobId, organization_id: ORGANIZATION_B }],
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B }],
  teams: [{ id: foreignTeamId, organization_id: ORGANIZATION_B, name: 'Fremdes Team', dissolved_at: null }],
  employee_records: [
    { id: foreignEmployeeRecordId, organization_id: ORGANIZATION_B, user_id: null, first_name: 'Fremd' },
  ],
});
const { getQualificationWorkspace, getPersonnelQualificationSummary } = await import(
  '@/lib/qualifications/workspace-actions'
);
const {
  getJobQualificationDetail,
  getProjectCapabilityRequirements,
  setJobCapabilityRequirements,
  setProjectCapabilityRequirements,
} = await import('@/lib/qualifications/requirement-actions');
const {
  createTeam,
  updateTeam,
  dissolveTeam,
  addTeamMembership,
  endTeamMembership,
  createCapability,
  retireCapabilityDefinition,
  addEmployeeCapability,
  updateEmployeeCapability,
  setApprenticeWarningEnabled,
  expandTeamForAssignment,
  getAssignmentTeamOptions,
} = await import('@/lib/qualifications/actions');

const requirement = [{ capabilityId: ownCapabilityId, requireConfirmation: false }];
const capabilityRecord = {
  validFrom: '2026-10-01',
  confirmationStatus: 'confirmed' as const,
  evidenceState: 'not_required' as const,
};
const writes = [
  ['createTeam', () => createTeam({ name: 'Kundendienst' })],
  ['updateTeam', () => updateTeam({ teamId: foreignTeamId, name: 'Kundendienst' })],
  ['dissolveTeam', () => dissolveTeam({ teamId: foreignTeamId })],
  [
    'addTeamMembership',
    () =>
      addTeamMembership({
        teamId: foreignTeamId,
        employeeRecordId: ownEmployeeRecordId,
        validFrom: '2026-10-01',
      }),
  ],
  [
    'endTeamMembership',
    () => endTeamMembership({ membershipId: foreignMembershipId, validUntil: '2026-10-31' }),
  ],
  ['createCapability', () => createCapability({ kind: 'skill', name: 'Löten' })],
  ['retireCapabilityDefinition', () => retireCapabilityDefinition(foreignCapabilityId)],
  [
    'addEmployeeCapability',
    () =>
      addEmployeeCapability({
        ...capabilityRecord,
        employeeRecordId: foreignEmployeeRecordId,
        capabilityId: ownCapabilityId,
      }),
  ],
  [
    'updateEmployeeCapability',
    () => updateEmployeeCapability({ ...capabilityRecord, recordId: foreignRecordId }),
  ],
  [
    'setJobCapabilityRequirements',
    () => setJobCapabilityRequirements({ jobId: foreignJobId, requirements: requirement }),
  ],
  [
    'setProjectCapabilityRequirements',
    () =>
      setProjectCapabilityRequirements({
        projectId: foreignProjectId,
        requirements: requirement,
        expectedRequirements: [],
      }),
  ],
] as const;
const reads = [
  ['getQualificationWorkspace', () => getQualificationWorkspace()],
  ['getPersonnelQualificationSummary', () => getPersonnelQualificationSummary(foreignEmployeeRecordId)],
  ['getJobQualificationDetail', () => getJobQualificationDetail(foreignJobId)],
  ['getProjectCapabilityRequirements', () => getProjectCapabilityRequirements(foreignProjectId)],
  ['expandTeamForAssignment', () => expandTeamForAssignment({ teamId: foreignTeamId })],
  ['getAssignmentTeamOptions', () => getAssignmentTeamOptions()],
] as const;
const notAuthorized = { success: false, error: 'not_authorized' };
const apprenticeWarning = ['setApprenticeWarningEnabled', () => setApprenticeWarningEnabled(true)] as const;

// Field workers are refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(world, [...writes, ...reads, apprenticeWarning], notAuthorized, 'none');

// The apprentice warning is an organization setting: Büro is refused too.
signInAs(world, 'buero');
await assertRefused(world, [apprenticeWarning], notAuthorized, 'none');

// A job, project or team of another organization is not found by the
// organization-scoped load, before any write.
await assertRefused(
  world,
  [writes[9], ['getJobQualificationDetail', () => getJobQualificationDetail(foreignJobId)]],
  { success: false, error: 'job_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['getProjectCapabilityRequirements', () => getProjectCapabilityRequirements(foreignProjectId)]],
  { success: false, error: 'project_not_found' },
  'reads',
);
await assertRefused(
  world,
  [['expandTeamForAssignment', () => expandTeamForAssignment({ teamId: foreignTeamId })]],
  { success: false, error: 'team_not_found' },
  'reads',
);
// Another organization's employee resolves to no summary at all.
assert.deepEqual(await getPersonnelQualificationSummary(foreignEmployeeRecordId), {
  success: true,
  data: null,
});

// The write functions refuse a foreign id under their lock because the action
// passes the caller's organization; one call, nothing else written.
refuseForeignIds(
  world,
  new Map([
    [foreignTeamId, 'team_not_found'],
    [foreignMembershipId, 'record_not_found'],
    [foreignCapabilityId, 'definition_not_found'],
    [foreignEmployeeRecordId, 'employee_not_found'],
    [foreignRecordId, 'record_not_found'],
    [foreignProjectId, 'project_not_found'],
  ]),
);
const refusals = [
  [writes[1], 'team_not_found'],
  [writes[2], 'team_not_found'],
  [writes[3], 'team_not_found'],
  [writes[4], 'record_not_found'],
  [writes[6], 'definition_not_found'],
  [writes[7], 'employee_not_found'],
  [writes[8], 'record_not_found'],
  // The checked replacement reports every refusal as a failed update.
  [writes[10], 'update_failed'],
] as const;
for (const [write, error] of refusals) {
  await assertRefused(world, [write], { success: false, error }, 'one-call');
  const [call] = world.rpcCalls;
  assert.ok(call, `${write[0]}: no database call`);
  assert.equal(call.args.p_organization_id, ORGANIZATION_A, `${write[0]}: not the caller's organization`);
}
