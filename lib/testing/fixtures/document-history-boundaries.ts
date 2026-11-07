// The real version and audit history actions over the in-memory database:
// the history of an ordinary document stays with Admin and Büro. A field
// worker assigned to the document's job still downloads its current version,
// but is refused its details with versions and audit history and every
// earlier version, before storage is reached. A foreign organization's
// document or version is not found for every role. A protected personnel
// document keeps its own rule: its employee reads the released versions and
// no audit history.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownJobId = '8e000000-0000-4000-8000-000000000001';
const ordinaryDocumentId = '8e000000-0000-4000-8000-000000000002';
const earlierVersionId = '8e000000-0000-4000-8000-000000000003';
const currentVersionId = '8e000000-0000-4000-8000-000000000004';
const foreignDocumentId = '8e000000-0000-4000-8000-000000000005';
const foreignVersionId = '8e000000-0000-4000-8000-000000000006';
const ownEmployeeRecordId = '8e000000-0000-4000-8000-000000000007';
const personnelDocumentId = '8e000000-0000-4000-8000-000000000008';
const releasedVersionId = '8e000000-0000-4000-8000-000000000009';
const unreleasedVersionId = '8e000000-0000-4000-8000-00000000000a';
const unknownId = '8e000000-0000-4000-8000-0000000000ff';

const document = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  folder_id: null,
  storage_path: `${organizationId}/${id}/vertrag.pdf`,
  original_file_name: 'vertrag.pdf',
  display_name: 'vertrag.pdf',
  mime_type: 'application/pdf',
  category: 'contract',
  current_version_number: 2,
  uploaded_by: CALLER_ID,
  deleted_at: null,
});
const version = (id: string, documentId: string, versionNumber: number, organizationId = ORGANIZATION_A) => ({
  id,
  organization_id: organizationId,
  document_id: documentId,
  version_number: versionNumber,
  storage_path: `${organizationId}/${documentId}/v${versionNumber}.pdf`,
  original_file_name: `vertrag-v${versionNumber}.pdf`,
  mime_type: 'application/pdf',
  uploaded_by: CALLER_ID,
  created_at: `2026-10-0${versionNumber}T08:00:00Z`,
});
const auditEvent = (documentId: string) => ({
  id: `${documentId.slice(0, -3)}aaa`,
  organization_id: ORGANIZATION_A,
  document_id: documentId,
  actor_id: CALLER_ID,
  event_type: 'version_uploaded',
  created_at: '2026-10-02T08:00:00Z',
});

const world = installActionWorld({
  documents: [
    document(ordinaryDocumentId, ORGANIZATION_A),
    document(personnelDocumentId, ORGANIZATION_A),
    document(foreignDocumentId, ORGANIZATION_B),
  ],
  document_versions: [
    version(earlierVersionId, ordinaryDocumentId, 1),
    version(currentVersionId, ordinaryDocumentId, 2),
    version(unreleasedVersionId, personnelDocumentId, 1),
    version(releasedVersionId, personnelDocumentId, 2),
    version(foreignVersionId, foreignDocumentId, 1, ORGANIZATION_B),
  ],
  document_audit_events: [auditEvent(ordinaryDocumentId), auditEvent(personnelDocumentId)],
  document_links: [
    {
      id: '8e000000-0000-4000-8000-0000000000a1',
      organization_id: ORGANIZATION_A,
      document_id: ordinaryDocumentId,
      job_id: ownJobId,
    },
  ],
  jobs: [{ id: ownJobId, organization_id: ORGANIZATION_A, title: 'Heizung tauschen', job_number: 'A-1' }],
  job_assignments: [
    {
      id: '8e000000-0000-4000-8000-0000000000b1',
      organization_id: ORGANIZATION_A,
      job_id: ownJobId,
      user_id: CALLER_ID,
    },
  ],
  employee_records: [{ id: ownEmployeeRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  personnel_documents: [
    {
      id: '8e000000-0000-4000-8000-0000000000c1',
      organization_id: ORGANIZATION_A,
      document_id: personnelDocumentId,
      employee_record_id: ownEmployeeRecordId,
      access_class: 'personnel_standard',
      personnel_document_releases: [{ document_version_number: 2, revoked_at: null }],
    },
  ],
  profiles: [{ id: CALLER_ID, first_name: 'Kim', last_name: 'Berger', email: 'caller@example.test' }],
});
// Storage stands in so an allowed read signs no real URL; a refusal never reaches it.
const signedPaths: string[] = [];
const unusedStorage = async (): Promise<never> => {
  throw new Error('a history read reached a storage write');
};
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    signedPaths.push(path);
    return `https://storage.example.test/${path}`;
  },
  copyStorageObject: unusedStorage,
  createSignedUploadUrl: unusedStorage,
  discardStorageObjects: unusedStorage,
  promoteUploadedObject: unusedStorage,
  uploadStagingPath: (path: string) => `staging/${path}`,
}));
const { getDocumentDetails, getDocumentSignedUrl, getDocumentVersionSignedUrl } = await import(
  '@/lib/documents/actions'
);

// The assigned field worker still downloads the current version of the job's
// document: the refusals below are about history, not about the assignment.
signInAs(world, 'employee');
const current = await getDocumentSignedUrl(ordinaryDocumentId);
assert.ok(current.success, 'the assigned employee lost the current version');

// History of an ordinary document stays with managers: the field worker is
// refused its details and each of its versions, and storage signs nothing.
signedPaths.length = 0;
await assertRefused(
  world,
  [
    ['getDocumentDetails', () => getDocumentDetails(ordinaryDocumentId)],
    ['getDocumentVersionSignedUrl earlier', () => getDocumentVersionSignedUrl(earlierVersionId)],
    [
      'getDocumentVersionSignedUrl download',
      () => getDocumentVersionSignedUrl(earlierVersionId, { download: true }),
    ],
    ['getDocumentVersionSignedUrl current', () => getDocumentVersionSignedUrl(currentVersionId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);
assert.deepEqual(signedPaths, [], 'a refused history read reached storage');

// A foreign organization's document or version answers like an unknown id, for every role.
for (const role of ['employee', 'buero', 'admin'] as const) {
  signInAs(world, role);
  for (const [name, call, error] of [
    ['getDocumentDetails foreign', () => getDocumentDetails(foreignDocumentId), 'document_not_found'],
    ['getDocumentDetails unknown', () => getDocumentDetails(unknownId), 'document_not_found'],
    [
      'getDocumentVersionSignedUrl foreign',
      () => getDocumentVersionSignedUrl(foreignVersionId),
      'version_not_found',
    ],
    [
      'getDocumentVersionSignedUrl unknown',
      () => getDocumentVersionSignedUrl(unknownId),
      'version_not_found',
    ],
  ] as const) {
    await assertRefused(world, [[`${role} ${name}`, call]], { success: false, error }, 'reads');
  }
}
assert.deepEqual(signedPaths, [], 'a foreign id reached storage');

// Admin and Büro read every version and the audit history, and download an earlier version.
for (const role of ['buero', 'admin'] as const) {
  signInAs(world, role);
  const details = await getDocumentDetails(ordinaryDocumentId);
  assert.ok(details.success, `${role}: the details were refused`);
  assert.deepEqual(
    details.versions.map((entry) => entry.versionNumber).toSorted(),
    [1, 2],
    `${role}: the versions changed`,
  );
  assert.equal(details.auditEvents.length, 1, `${role}: the audit history changed`);
  signedPaths.length = 0;
  const earlier = await getDocumentVersionSignedUrl(earlierVersionId, { download: true });
  assert.ok(earlier.success, `${role}: the earlier version was refused`);
  assert.deepEqual(signedPaths, [`${ORGANIZATION_A}/${ordinaryDocumentId}/v1.pdf`]);
}

// A protected personnel document keeps its rule: its employee reads only the
// released version and no audit history.
signInAs(world, 'employee');
const personnel = await getDocumentDetails(personnelDocumentId);
assert.ok(personnel.success, 'the employee lost their released personnel document');
assert.deepEqual(
  personnel.versions.map((entry) => entry.versionNumber),
  [2],
);
assert.deepEqual(personnel.auditEvents, []);
assert.ok((await getDocumentVersionSignedUrl(releasedVersionId)).success, 'the released version was refused');
await assertRefused(
  world,
  [['getDocumentVersionSignedUrl unreleased', () => getDocumentVersionSignedUrl(unreleasedVersionId)]],
  { success: false, error: 'not_authorized' },
  'reads',
);
