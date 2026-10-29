// Actual personnel lifecycle writes, uploads and template actions over the
// in-memory database: an employee manages no lifecycle and uploads only their
// own health evidence, Büro neither changes access or employment nor exports
// or publishes, and an Admin of organization A reaches no employee record,
// plan, template, requirement or document of organization B. A refused call
// signs no storage URL, calls no write function and changes no row.
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
import { assertCallerScopedCalls, databaseSnapshot } from './workforce-boundary-support';

// Fixture-only value: it keys the upload cleanup token, which a forged token must fail.
process.env.SUPABASE_SECRET_KEY = 'fixture-secret-key';

const ownRecordId = '82000000-0000-4000-8000-000000000001';
const colleagueRecordId = '82000000-0000-4000-8000-000000000002';
const foreignRecordId = '82000000-0000-4000-8000-000000000003';
const colleagueId = '82000000-0000-4000-8000-000000000004';
const ownPlanId = '82000000-0000-4000-8000-000000000005';
const foreignPlanId = '82000000-0000-4000-8000-000000000006';
const ownTemplateId = '82000000-0000-4000-8000-000000000007';
const foreignTemplateId = '82000000-0000-4000-8000-000000000008';
const foreignRequirementId = '82000000-0000-4000-8000-000000000009';
const foreignPersonnelDocumentId = '82000000-0000-4000-8000-00000000000a';
const foreignDocumentId = '82000000-0000-4000-8000-00000000000b';
const operationId = '82000000-0000-4000-8000-00000000000c';
const uploadDocumentId = '82000000-0000-4000-8000-00000000000d';
const now = '2026-10-01T08:00:00.000Z';

const template = (id: string, organizationId: string, versionId: string) => ({
  id,
  organization_id: organizationId,
  name: 'Einarbeitung Monteur',
  description: null,
  state: 'published',
  current_version_number: 1,
  version: 1,
  personnel_onboarding_template_versions: [{ id: versionId, version_number: 1 }],
});
const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID },
    { id: colleagueRecordId, organization_id: ORGANIZATION_A, user_id: colleagueId },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null },
  ],
  personnel_onboarding_plans: [
    { id: ownPlanId, organization_id: ORGANIZATION_A, employee_record_id: colleagueRecordId },
    { id: foreignPlanId, organization_id: ORGANIZATION_B, employee_record_id: foreignRecordId },
  ],
  personnel_onboarding_templates: [
    template(ownTemplateId, ORGANIZATION_A, '82000000-0000-4000-8000-0000000000a1'),
    template(foreignTemplateId, ORGANIZATION_B, '82000000-0000-4000-8000-0000000000b1'),
  ],
  personnel_onboarding_requirements: [
    { id: foreignRequirementId, organization_id: ORGANIZATION_B, employee_record_id: foreignRecordId },
  ],
  personnel_documents: [
    {
      id: foreignPersonnelDocumentId,
      organization_id: ORGANIZATION_B,
      employee_record_id: foreignRecordId,
      document_id: foreignDocumentId,
      access_class: 'personnel_standard',
      documents: {
        id: foreignDocumentId,
        organization_id: ORGANIZATION_B,
        storage_path: `${ORGANIZATION_B}/${foreignDocumentId}/vertrag.pdf`,
        display_name: 'vertrag.pdf',
        current_version_number: 1,
        deleted_at: null,
      },
      personnel_document_releases: [{ document_version_number: 1, revoked_at: null }],
    },
  ],
});
// The lifecycle functions load their target inside the organization they are
// given (supabase/tests/p1_24_people_lifecycle.sql); here only that lookup.
const inOrganization = (table: string, id: unknown, organizationId: unknown): boolean =>
  tableRows(world, table).some((row) => row.id === id && row.organization_id === organizationId);
world.rpc = ({ name, args }) => {
  const organizationId = args.p_organization_id;
  const refusal = (message: string) => ({ data: null, error: { code: 'P0001', message } });
  if (name === 'publish_personnel_onboarding_template') {
    return args.p_template_id === null ||
      inOrganization('personnel_onboarding_templates', args.p_template_id, organizationId)
      ? { data: operationId, error: null }
      : refusal('template_not_found');
  }
  if (name === 'acknowledge_personnel_item' && args.p_requirement_id !== null) {
    return inOrganization('personnel_onboarding_requirements', args.p_requirement_id, organizationId)
      ? { data: operationId, error: null }
      : refusal('requirement_not_found');
  }
  if (name === 'acknowledge_personnel_item') {
    return inOrganization('personnel_documents', args.p_personnel_document_id, organizationId)
      ? { data: operationId, error: null }
      : refusal('personnel_document_not_found');
  }
  return refusal(`unexpected_function_${name}`);
};
const storageCalls: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    storageCalls.push(`download:${path}`);
    return `https://storage.example.test/${path}`;
  },
  createSignedUploadUrl: async ({ path }: { path: string }) => {
    storageCalls.push(`upload:${path}`);
    return `https://storage.example.test/${path}`;
  },
  discardStorageObjects: async ({ paths }: { paths: string[] }) => {
    storageCalls.push(`discard:${paths.join(',')}`);
  },
  headStorageObject: async ({ path }: { path: string }) => {
    storageCalls.push(`head:${path}`);
    return { exists: true, sizeBytes: 100, contentType: 'application/pdf' };
  },
  promoteUploadedObject: async ({ path }: { path: string }) => {
    storageCalls.push(`promote:${path}`);
    return { exists: true, sizeBytes: 100, contentType: 'application/pdf' };
  },
  uploadStagingPath: (organizationId: string, path: string) =>
    `${organizationId}/staging/${path.slice(organizationId.length + 1)}`,
}));
const {
  acknowledgePersonnelDocument,
  acknowledgePersonnelRequirement,
  exportPersonnelLifecycleManifest,
  setPersonnelAccessTransition,
  setPersonnelEmploymentTransition,
} = await import('@/lib/personnel/lifecycle-actions');
const {
  createPersonnelOnboardingPlan,
  getPersonnelOnboardingTemplates,
  publishPersonnelOnboardingTemplate,
  savePersonnelOnboardingRequirement,
} = await import('@/lib/personnel/onboarding-actions');
const {
  cleanupPersonnelDocumentUpload,
  createPersonnelDocumentUploadTicket,
  finalizePersonnelDocumentUpload,
  getPersonnelDocumentSignedUrl,
  setPersonnelDocumentRelease,
} = await import('@/lib/personnel/document-actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const recordNotFound = { success: false, error: 'record_not_found' };
const accessTransition = (employeeRecordId: string) =>
  setPersonnelAccessTransition({
    employeeRecordId,
    expectedVersion: 0,
    transitionKind: 'suspend_now',
    effectiveAt: now,
    reason: 'Zugang sperren',
    operationId,
  });
const employmentTransition = (employeeRecordId: string) =>
  setPersonnelEmploymentTransition({
    employeeRecordId,
    expectedVersion: 0,
    transitionKind: 'record_notice',
    effectiveOn: '2026-12-31',
    reason: 'Kündigung erfasst',
    operationId,
  });
const onboardingPlan = (employeeRecordId: string) =>
  createPersonnelOnboardingPlan({
    employeeRecordId,
    templateVersionId: null,
    name: 'Einarbeitung',
    targetStartDate: null,
    operationId,
  });
const requirement = (planId: string) =>
  savePersonnelOnboardingRequirement({
    planId,
    requirementId: null,
    expectedVersion: 0,
    requirementType: 'manual',
    title: 'Werkzeug ausgeben',
    description: null,
    isRequired: true,
    blocksAccess: false,
    ownerEmployeeRecordId: null,
    dueDate: null,
    state: 'missing',
    blockerReason: null,
    operationId,
  });
const publishTemplate = (templateId: string | null) =>
  publishPersonnelOnboardingTemplate({
    templateId,
    expectedVersion: 1,
    name: 'Einarbeitung Monteur',
    description: null,
    items: [
      {
        requirementType: 'manual',
        title: 'Werkzeug ausgeben',
        description: null,
        isRequired: true,
        blocksAccess: false,
        dueOffsetDays: null,
      },
    ],
    operationId,
  });
const documentRelease = (employeeRecordId: string) =>
  setPersonnelDocumentRelease({
    employeeRecordId,
    personnelDocumentId: foreignPersonnelDocumentId,
    documentVersionNumber: 1,
    release: true,
    reason: null,
    operationId,
  });
const upload = { fileName: 'nachweis.pdf', operationId };
const ticket = (
  employeeRecordId: string,
  accessClass: 'personnel_standard' | 'admin_restricted' | 'health_evidence',
) => createPersonnelDocumentUploadTicket({ ...upload, employeeRecordId, accessClass, fileSizeBytes: 100 });
const forgedToken = 'x'.repeat(64);
const cleanup = (employeeRecordId: string, accessClass: 'admin_restricted' | 'health_evidence') =>
  cleanupPersonnelDocumentUpload({
    ...upload,
    employeeRecordId,
    accessClass,
    documentId: uploadDocumentId,
    cleanupToken: forgedToken,
  });
const finalize = (employeeRecordId: string, accessClass: 'admin_restricted' | 'health_evidence') =>
  finalizePersonnelDocumentUpload({
    ...upload,
    employeeRecordId,
    accessClass,
    documentId: uploadDocumentId,
    documentType: 'Gesundheitsnachweis',
    evidenceState: 'valid',
    validUntil: null,
    cleanupToken: forgedToken,
  });

// An employee manages no lifecycle and reads no template; each is refused before the database.
signInAs(world, 'employee');
assert.deepEqual(await accessTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await employmentTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await onboardingPlan(colleagueRecordId), notAuthorized);
assert.deepEqual(await requirement(ownPlanId), notAuthorized);
assert.deepEqual(await publishTemplate(null), notAuthorized);
assert.deepEqual(await getPersonnelOnboardingTemplates(), notAuthorized);
assert.deepEqual(await documentRelease(colleagueRecordId), notAuthorized);
assert.deepEqual(await exportPersonnelLifecycleManifest(colleagueRecordId), notAuthorized);
assert.equal(world.adminClientRequests, 0);

// An employee uploads only their own health evidence: a colleague's record or another class is refused.
assert.deepEqual(await ticket(colleagueRecordId, 'health_evidence'), notAuthorized);
assert.deepEqual(await ticket(ownRecordId, 'personnel_standard'), notAuthorized);
assert.deepEqual(await cleanup(colleagueRecordId, 'health_evidence'), notAuthorized);
assert.deepEqual(await finalize(colleagueRecordId, 'health_evidence'), notAuthorized);
// A forged cleanup token is refused even for the employee's own record.
assert.deepEqual(await cleanup(ownRecordId, 'health_evidence'), notAuthorized);
assert.deepEqual(await finalize(ownRecordId, 'health_evidence'), notAuthorized);

// Büro changes neither access nor employment, exports nothing, publishes no
// template and uploads no Admin-only or health document.
signInAs(world, 'buero');
assert.deepEqual(await accessTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await employmentTransition(colleagueRecordId), notAuthorized);
assert.deepEqual(await exportPersonnelLifecycleManifest(colleagueRecordId), notAuthorized);
assert.deepEqual(await publishTemplate(ownTemplateId), notAuthorized);
assert.deepEqual(await ticket(colleagueRecordId, 'admin_restricted'), notAuthorized);
assert.deepEqual(await cleanup(colleagueRecordId, 'admin_restricted'), notAuthorized);
assert.deepEqual(await finalize(colleagueRecordId, 'health_evidence'), notAuthorized);

// An Admin of organization A reaches no record, plan or document of organization B.
signInAs(world, 'admin');
assert.deepEqual(await accessTransition(foreignRecordId), recordNotFound);
assert.deepEqual(await employmentTransition(foreignRecordId), recordNotFound);
assert.deepEqual(await onboardingPlan(foreignRecordId), recordNotFound);
assert.deepEqual(await requirement(foreignPlanId), { success: false, error: 'plan_not_found' });
assert.deepEqual(await documentRelease(foreignRecordId), recordNotFound);
assert.deepEqual(await exportPersonnelLifecycleManifest(foreignRecordId), recordNotFound);
assert.deepEqual(await ticket(foreignRecordId, 'personnel_standard'), notAuthorized);
assert.deepEqual(await cleanup(foreignRecordId, 'admin_restricted'), notAuthorized);
assert.deepEqual(await finalize(foreignRecordId, 'admin_restricted'), notAuthorized);
assert.deepEqual(await getPersonnelDocumentSignedUrl(foreignDocumentId), notAuthorized);
assert.deepEqual(storageCalls, [], 'a refused call signs and touches no storage object');
assert.equal(world.rpcCalls.length, 0);

// The template list holds only organization A's templates.
const templates = await getPersonnelOnboardingTemplates();
assert.ok(templates.success);
assert.deepEqual(
  templates.data.map((entry) => entry.id),
  [ownTemplateId],
);

// Publishing over another organization's template is refused by its one call.
assert.deepEqual(await publishTemplate(foreignTemplateId), { success: false, error: 'template_not_found' });

// An employee acknowledges no requirement or document of another organization.
signInAs(world, 'employee');
assert.deepEqual(
  await acknowledgePersonnelRequirement({
    requirementId: foreignRequirementId,
    requirementVersion: 1,
    statement: 'Gelesen und erledigt.',
    operationId,
  }),
  { success: false, error: 'requirement_not_found' },
);
assert.deepEqual(
  await acknowledgePersonnelDocument({
    personnelDocumentId: foreignPersonnelDocumentId,
    documentVersionNumber: 1,
    statement: 'Erhalten.',
    operationId,
  }),
  { success: false, error: 'personnel_document_not_found' },
);
assert.equal(world.rpcCalls.length, 3);
assertCallerScopedCalls(world);
assert.deepEqual(storageCalls, []);
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');

// An Admin's upload: the first finalize copies the staged upload to the document key,
// and a replay of the finalized upload reads the registered object without copying
// over it. A cleanup of an unregistered upload removes its staging key too.
signInAs(world, 'admin');
storageCalls.length = 0;
world.tables.documents = [];
const issueTicket = async () => {
  const issued = await ticket(colleagueRecordId, 'admin_restricted');
  assert.ok(issued.success, JSON.stringify(issued));
  const request = {
    ...upload,
    employeeRecordId: colleagueRecordId,
    accessClass: 'admin_restricted' as const,
    documentId: issued.data.documentId,
    cleanupToken: issued.data.cleanupToken,
  };
  return { request, path: `${ORGANIZATION_A}/${issued.data.documentId}/nachweis.pdf` };
};
const registered = await issueTicket();
const rpcBeforeUploads = world.rpc;
world.rpc = (call) =>
  call.name === 'finalize_personnel_document_metadata'
    ? { data: registered.request.documentId, error: null }
    : rpcBeforeUploads(call);
const finalizeRegistered = () =>
  finalizePersonnelDocumentUpload({
    ...registered.request,
    documentType: 'Vertrag',
    evidenceState: 'valid',
    validUntil: null,
  });
const finalized = { success: true, data: { documentId: registered.request.documentId } };
// A finalize whose registration read fails reports it and touches no storage.
world.failingTables.add('documents');
assert.deepEqual(await finalizeRegistered(), { success: false, error: 'load_failed' });
world.failingTables.delete('documents');
assert.deepEqual(await finalizeRegistered(), finalized);
world.tables.documents.push({
  id: registered.request.documentId,
  organization_id: ORGANIZATION_A,
  storage_path: registered.path,
});
assert.deepEqual(await finalizeRegistered(), finalized);
const abandoned = await issueTicket();
assert.deepEqual(await cleanupPersonnelDocumentUpload(abandoned.request), { success: true });
assert.deepEqual(storageCalls, [
  `upload:${registered.path}`,
  `promote:${registered.path}`,
  `head:${registered.path}`,
  `upload:${abandoned.path}`,
  `discard:${ORGANIZATION_A}/staging/${abandoned.path.slice(ORGANIZATION_A.length + 1)},${abandoned.path}`,
]);
