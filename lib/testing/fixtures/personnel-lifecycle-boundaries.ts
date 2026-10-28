// Actual personnel lifecycle actions over the in-memory database: only
// managers reach another person's lifecycle, the access transition is
// Admin-only, an employee record or protected document of another
// organization is unreachable, and a prestart employee reads and acknowledges
// only their own items.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const ownRecordId = '60000000-0000-4000-8000-000000000001';
const colleagueRecordId = '60000000-0000-4000-8000-000000000002';
const foreignRecordId = '60000000-0000-4000-8000-000000000009';
const ownRequirementId = '61000000-0000-4000-8000-000000000001';
const colleagueRequirementId = '61000000-0000-4000-8000-000000000002';
const ownDocumentId = '62000000-0000-4000-8000-000000000001';
const colleagueDocumentId = '62000000-0000-4000-8000-000000000002';
const foreignDocumentId = '62000000-0000-4000-8000-000000000009';
const colleagueId = '30000000-0000-4000-8000-000000000021';
const foreignUserId = '30000000-0000-4000-8000-000000000029';
const operationId = '63000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';

const employeeRecord = (id: string, organizationId: string, userId: string) => ({
  id,
  organization_id: organizationId,
  user_id: userId,
});
const requirement = (id: string, employeeRecordId: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  plan_id: '64000000-0000-4000-8000-000000000001',
  employee_record_id: employeeRecordId,
  requirement_type: 'acknowledgement',
  title: 'Arbeitsschutz lesen',
  description: null,
  is_required: true,
  blocks_access: false,
  owner_employee_record_id: null,
  due_date: null,
  state: 'missing',
  blocker_reason: null,
  version: 1,
  sort_order: 0,
});
// The in-memory database has no joins: the embedded file and its releases are
// stored on the personnel document row itself.
const personnelDocument = (
  documentId: string,
  organizationId: string,
  employeeRecordId: string,
  accessClass: string,
) => ({
  id: `7${documentId.slice(1)}`,
  organization_id: organizationId,
  employee_record_id: employeeRecordId,
  document_id: documentId,
  document_type: 'Gesundheitsnachweis',
  access_class: accessClass,
  evidence_state: 'valid',
  valid_until: null,
  version: 1,
  updated_at: now,
  documents: {
    id: documentId,
    organization_id: organizationId,
    storage_path: `${organizationId}/${documentId}/nachweis.pdf`,
    display_name: 'nachweis.pdf',
    current_version_number: 1,
    deleted_at: null,
  },
  personnel_document_releases: [{ document_version_number: 1, revoked_at: null }],
});

const world = installActionWorld({
  employee_records: [
    employeeRecord(ownRecordId, ORGANIZATION_A, CALLER_ID),
    employeeRecord(colleagueRecordId, ORGANIZATION_A, colleagueId),
    employeeRecord(foreignRecordId, ORGANIZATION_B, foreignUserId),
  ],
  personnel_onboarding_requirements: [
    requirement(ownRequirementId, ownRecordId),
    requirement(colleagueRequirementId, colleagueRecordId),
  ],
  personnel_documents: [
    personnelDocument(ownDocumentId, ORGANIZATION_A, ownRecordId, 'health_evidence'),
    personnelDocument(colleagueDocumentId, ORGANIZATION_A, colleagueRecordId, 'admin_restricted'),
    personnelDocument(foreignDocumentId, ORGANIZATION_B, foreignRecordId, 'personnel_standard'),
  ],
});
// The database function completes a requirement only for the acting employee's
// own record inside the organization it is given (p1_24_people_lifecycle.sql).
world.rpc = ({ name, args }) => {
  assert.equal(name, 'acknowledge_personnel_item');
  const target = tableRows(world, 'personnel_onboarding_requirements').find(
    (row) => row.id === args.p_requirement_id && row.organization_id === args.p_organization_id,
  );
  if (!target) return { data: null, error: { message: 'requirement_not_found' } };
  const owner = tableRows(world, 'employee_records').find((row) => row.id === target.employee_record_id);
  if (owner?.user_id !== args.p_actor_id) return { data: null, error: { message: 'forbidden' } };
  return { data: '65000000-0000-4000-8000-000000000001', error: null };
};
const signedPaths: string[] = [];
const outsideFixture = (name: string) => (): never => {
  throw new Error(`${name} is outside this fixture`);
};
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    signedPaths.push(path);
    return `https://storage.example.test/${path}`;
  },
  createSignedUploadUrl: outsideFixture('createSignedUploadUrl'),
  discardStorageObjects: outsideFixture('discardStorageObjects'),
  headStorageObject: outsideFixture('headStorageObject'),
  promoteUploadedObject: outsideFixture('promoteUploadedObject'),
  uploadStagingPath: outsideFixture('uploadStagingPath'),
}));
const actions = await import('@/lib/personnel/lifecycle-actions');

const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();
const notAuthorized = { success: false, error: 'not_authorized' };
const recordNotFound = { success: false, error: 'record_not_found' };
const accessTransition = (employeeRecordId: string) =>
  actions.setPersonnelAccessTransition({
    employeeRecordId,
    expectedVersion: 0,
    transitionKind: 'suspend_now',
    effectiveAt: now,
    reason: 'Fremdzugriff',
    operationId,
  });
const onboardingPlan = (employeeRecordId: string) =>
  actions.createPersonnelOnboardingPlan({
    employeeRecordId,
    templateVersionId: null,
    name: 'Einarbeitung',
    targetStartDate: null,
    operationId,
  });
const documentRelease = (employeeRecordId: string, personnelDocumentId: string) =>
  actions.setPersonnelDocumentRelease({
    employeeRecordId,
    personnelDocumentId,
    documentVersionNumber: 1,
    release: true,
    reason: null,
    operationId,
  });
const signedUrlOf = (documentId: string) => actions.getPersonnelDocumentSignedUrl(documentId);

// A signed-out caller is denied before the database.
world.callerId = null;
assert.deepEqual(await actions.getPersonnelLifecycle(colleagueRecordId), {
  success: false,
  error: 'not_authenticated',
});
assert.deepEqual(await signedUrlOf(ownDocumentId), { success: false, error: 'not_authenticated' });
assert.equal(world.adminClientRequests, 0);

// An employee reaches no colleague's lifecycle, and is refused before the database.
signInAs(world, 'employee');
assert.deepEqual(await actions.getPersonnelLifecycle(colleagueRecordId), notAuthorized);
assert.deepEqual(await accessTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await onboardingPlan(colleagueRecordId), notAuthorized);
assert.deepEqual(await documentRelease(colleagueRecordId, colleagueDocumentId), notAuthorized);
assert.equal(world.adminClientRequests, 0);
// The employee opens their own released document, never a colleague's.
assert.deepEqual(await signedUrlOf(colleagueDocumentId), notAuthorized);
assert.ok((await signedUrlOf(ownDocumentId)).success);

// Büro manages lifecycles but neither changes access nor opens an Admin-only document.
signInAs(world, 'buero');
assert.deepEqual(await accessTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await signedUrlOf(colleagueDocumentId), notAuthorized);

// An Admin of organization A reaches no employee record or document of organization B.
signInAs(world, 'admin');
assert.deepEqual(await actions.getPersonnelLifecycle(foreignRecordId), recordNotFound);
assert.deepEqual(await accessTransition(foreignRecordId), recordNotFound);
assert.deepEqual(await onboardingPlan(foreignRecordId), recordNotFound);
assert.deepEqual(await documentRelease(foreignRecordId, foreignDocumentId), recordNotFound);
assert.deepEqual(await actions.exportPersonnelLifecycleManifest(foreignRecordId), recordNotFound);
assert.deepEqual(await signedUrlOf(foreignDocumentId), notAuthorized);
assert.deepEqual(signedPaths, [`${ORGANIZATION_A}/${ownDocumentId}/nachweis.pdf`]);
assert.equal(world.rpcCalls.length, 0);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied call may write');

// A prestart employee has no manager context at all.
signInAs(world, null, ORGANIZATION_A);
world.prestartOrganizationIds = [ORGANIZATION_A];
world.activeOrganizationCookie = ORGANIZATION_A;
assert.deepEqual(await actions.getPersonnelLifecycle(ownRecordId), {
  success: false,
  error: 'no_active_org',
});
assert.deepEqual(await accessTransition(ownRecordId), { success: false, error: 'no_active_org' });

// The prestart employee reads only their own record's items and documents.
const own = await actions.getOwnPersonnelActions();
assert.ok(own.success);
assert.equal(own.data.employeeRecordId, ownRecordId);
assert.equal(own.data.organizationId, ORGANIZATION_A);
assert.equal(own.data.prestart, true);
assert.deepEqual(
  own.data.requirements.map((item) => item.id),
  [ownRequirementId],
);
assert.deepEqual(
  own.data.documents.map((document) => document.documentId),
  [ownDocumentId],
);
assert.ok((await signedUrlOf(ownDocumentId)).success);
assert.deepEqual(await signedUrlOf(colleagueDocumentId), notAuthorized);
assert.deepEqual(await signedUrlOf(foreignDocumentId), notAuthorized);

// An acknowledgement acts as the session employee in their own organization;
// a colleague's requirement is refused by the function.
const acknowledgement = (requirementId: string) =>
  actions.acknowledgePersonnelRequirement({
    requirementId,
    requirementVersion: 1,
    statement: 'Gelesen und erledigt.',
    operationId,
  });
assert.deepEqual(await acknowledgement(colleagueRequirementId), { success: false, error: 'forbidden' });
assert.ok((await acknowledgement(ownRequirementId)).success);
assert.deepEqual(
  world.rpcCalls.map((call) => [call.args.p_organization_id, call.args.p_actor_id]),
  [
    [ORGANIZATION_A, CALLER_ID],
    [ORGANIZATION_A, CALLER_ID],
  ],
);

// A cookie for an organization the caller has no membership in resolves nothing.
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(await actions.getOwnPersonnelActions(), { success: false, error: 'not_a_member' });
assert.deepEqual(await acknowledgement(ownRequirementId), { success: false, error: 'not_a_member' });
assert.equal(world.rpcCalls.length, 2);
assert.equal(databaseSnapshot(), initialDatabase, 'no self-service call may write rows outside the function');
