// Actual document library, folder, record-document and version actions over
// the in-memory database: a field worker is refused before any read or write,
// and a folder, document, customer, request, equipment, service case,
// maintenance coverage or employee of another organization is not found
// before any write; storage is never reached on a refusal.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownFolderId = '8f000000-0000-4000-8000-000000000001';
const foreignFolderId = '8f000000-0000-4000-8000-000000000002';
const foreignDocumentId = '8f000000-0000-4000-8000-000000000003';
const foreignDeletedDocumentId = '8f000000-0000-4000-8000-000000000004';
const foreignClientId = '8f000000-0000-4000-8000-000000000005';
const foreignRequestId = '8f000000-0000-4000-8000-000000000006';
const foreignEquipmentId = '8f000000-0000-4000-8000-000000000007';
const foreignServiceCaseId = '8f000000-0000-4000-8000-000000000008';
const foreignCoverageId = '8f000000-0000-4000-8000-000000000009';
const foreignMemberId = '8f000000-0000-4000-8000-00000000000a';

const folder = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  parent_folder_id: null,
  name: 'Verträge',
  deleted_at: null,
});
const document = (id: string, deletedAt: string | null) => ({
  id,
  organization_id: ORGANIZATION_B,
  folder_id: null,
  storage_path: `${ORGANIZATION_B}/${id}/vertrag.pdf`,
  display_name: 'vertrag.pdf',
  category: 'contract',
  current_version_number: 1,
  deleted_at: deletedAt,
});

const world = installActionWorld({
  document_folders: [folder(ownFolderId, ORGANIZATION_A), folder(foreignFolderId, ORGANIZATION_B)],
  documents: [document(foreignDocumentId, null), document(foreignDeletedDocumentId, '2026-10-01T08:00:00Z')],
  personnel_documents: [],
  clients: [{ id: foreignClientId, organization_id: ORGANIZATION_B }],
  client_requests: [{ id: foreignRequestId, organization_id: ORGANIZATION_B }],
  installed_equipment: [{ id: foreignEquipmentId, organization_id: ORGANIZATION_B }],
  service_cases: [{ id: foreignServiceCaseId, organization_id: ORGANIZATION_B }],
  maintenance_coverages: [{ id: foreignCoverageId, organization_id: ORGANIZATION_B }],
  organization_members: [{ user_id: foreignMemberId, organization_id: ORGANIZATION_B, role: 'employee' }],
});
const {
  getDocumentFolderOptions,
  getAttachableDocuments,
  getRequestDocuments,
  getDocumentLinkEmployees,
  getClientDocuments,
  getEquipmentDocuments,
  getServiceCaseDocuments,
  getMaintenanceCoverageDocuments,
  getEmployeeDocuments,
  createDocumentFolder,
  moveDocumentFolder,
  copyDocumentFolder,
  copyDocument,
  restoreDocument,
  permanentlyDeleteDocument,
  createDocumentVersionUploadTicket,
  finalizeDocumentVersionUpload,
} = await import('@/lib/documents/actions');

const recordReads = [
  [
    'getAttachableDocuments',
    () => getAttachableDocuments({ targetType: 'client', targetId: foreignClientId }),
    'client_not_found',
  ],
  ['getRequestDocuments', () => getRequestDocuments(foreignRequestId), 'request_not_found'],
  ['getClientDocuments', () => getClientDocuments(foreignClientId), 'client_not_found'],
  ['getEquipmentDocuments', () => getEquipmentDocuments(foreignEquipmentId), 'installed_equipment_not_found'],
  ['getServiceCaseDocuments', () => getServiceCaseDocuments(foreignServiceCaseId), 'service_case_not_found'],
  [
    'getMaintenanceCoverageDocuments',
    () => getMaintenanceCoverageDocuments(foreignCoverageId),
    'maintenance_coverage_not_found',
  ],
  ['getEmployeeDocuments', () => getEmployeeDocuments(foreignMemberId), 'employee_not_found'],
] as const;
const libraryWrites = [
  [
    'createDocumentFolder',
    () => createDocumentFolder({ name: 'Angebote', parentFolderId: foreignFolderId }),
    'folder_not_found',
  ],
  [
    'moveDocumentFolder',
    () => moveDocumentFolder({ folderId: foreignFolderId, parentFolderId: ownFolderId }),
    'folder_not_found',
  ],
  ['copyDocumentFolder', () => copyDocumentFolder({ folderId: foreignFolderId }), 'folder_not_found'],
  ['copyDocument', () => copyDocument({ documentId: foreignDocumentId }), 'document_not_found'],
  ['restoreDocument', () => restoreDocument(foreignDeletedDocumentId), 'document_not_found'],
  [
    'permanentlyDeleteDocument',
    () => permanentlyDeleteDocument(foreignDeletedDocumentId),
    'document_not_found',
  ],
  [
    'createDocumentVersionUploadTicket',
    () =>
      createDocumentVersionUploadTicket({
        documentId: foreignDocumentId,
        fileName: 'vertrag.pdf',
        fileSizeBytes: 2048,
        mimeType: 'application/pdf',
      }),
    'document_not_found',
  ],
  [
    'finalizeDocumentVersionUpload',
    () =>
      finalizeDocumentVersionUpload({
        documentId: foreignDocumentId,
        versionNumber: 2,
        fileName: 'vertrag.pdf',
      }),
    'document_not_found',
  ],
] as const;
const optionReads = [
  ['getDocumentFolderOptions', () => getDocumentFolderOptions()],
  ['getDocumentLinkEmployees', () => getDocumentLinkEmployees()],
] as const;
const asCall = ([name, call]: readonly [string, () => Promise<unknown>, string?]) => [name, call] as const;

// Field workers are refused every library read and write before any row is read.
signInAs(world, 'employee');
await assertRefused(
  world,
  [...optionReads, ...recordReads.map(asCall), ...libraryWrites.map(asCall)],
  { success: false, error: 'not_authorized' },
  'reads',
);

// Büro does not find another organization's records, folders or documents,
// and no refusal writes a row or calls a write function.
signInAs(world, 'buero');
for (const [name, call, error] of [...recordReads, ...libraryWrites]) {
  await assertRefused(world, [[name, call]], { success: false, error }, 'reads');
}
const options = await getDocumentFolderOptions();
assert.ok(options.success, 'the folder options failed');
assert.deepEqual(
  options.folders.map((option) => option.id),
  [ownFolderId],
);
