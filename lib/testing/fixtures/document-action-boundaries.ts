// Actual document library, folder, record-document and version actions over
// the in-memory database: a field worker is refused before any read or write,
// and a folder, document, customer, request, equipment, service case,
// maintenance coverage or employee of another organization is not found
// before any write; storage is never reached on a refusal. A trashed personnel
// document of an Admin-only access class comes back only through an Admin. A
// release lets Büro read an Admin-only personnel document about themselves,
// never change it: every document write refuses it, and an Admin's write and
// Büro's write of a standard personnel document still reach their function.
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
const restrictedDeletedDocumentId = '8f000000-0000-4000-8000-00000000000b';
const standardDeletedDocumentId = '8f000000-0000-4000-8000-00000000000c';
const ownEmployeeRecordId = '8f000000-0000-4000-8000-00000000000d';
const releasedRestrictedDocumentId = '8f000000-0000-4000-8000-00000000000e';
const releasedHealthDocumentId = '8f000000-0000-4000-8000-00000000000f';
const ownStandardDocumentId = '8f000000-0000-4000-8000-000000000010';
const ownClientId = '8f000000-0000-4000-8000-000000000011';
const releasedRestrictedLinkId = '8f000000-0000-4000-8000-000000000012';

const folder = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  parent_folder_id: null,
  name: 'Verträge',
  deleted_at: null,
});
const document = (id: string, deletedAt: string | null, organizationId = ORGANIZATION_B) => ({
  id,
  organization_id: organizationId,
  folder_id: null,
  storage_path: `${organizationId}/${id}/vertrag.pdf`,
  display_name: 'vertrag.pdf',
  category: 'contract',
  current_version_number: 1,
  deleted_at: deletedAt,
});

const world = installActionWorld({
  document_folders: [folder(ownFolderId, ORGANIZATION_A), folder(foreignFolderId, ORGANIZATION_B)],
  documents: [
    document(foreignDocumentId, null),
    document(foreignDeletedDocumentId, '2026-10-01T08:00:00Z'),
    document(restrictedDeletedDocumentId, '2026-10-01T08:00:00Z', ORGANIZATION_A),
    document(standardDeletedDocumentId, '2026-10-01T08:00:00Z', ORGANIZATION_A),
    document(releasedRestrictedDocumentId, null, ORGANIZATION_A),
    document(releasedHealthDocumentId, null, ORGANIZATION_A),
    document(ownStandardDocumentId, null, ORGANIZATION_A),
  ],
  employee_records: [{ id: ownEmployeeRecordId, organization_id: ORGANIZATION_A, user_id: CALLER_ID }],
  personnel_documents: [
    {
      organization_id: ORGANIZATION_A,
      document_id: restrictedDeletedDocumentId,
      access_class: 'health_evidence',
    },
    {
      organization_id: ORGANIZATION_A,
      document_id: standardDeletedDocumentId,
      access_class: 'personnel_standard',
    },
    ...(
      [
        [releasedRestrictedDocumentId, 'admin_restricted'],
        [releasedHealthDocumentId, 'health_evidence'],
        [ownStandardDocumentId, 'personnel_standard'],
      ] as const
    ).map(([documentId, accessClass]) => ({
      organization_id: ORGANIZATION_A,
      document_id: documentId,
      employee_record_id: ownEmployeeRecordId,
      access_class: accessClass,
      personnel_document_releases: [{ document_version_number: 1, revoked_at: null }],
    })),
  ],
  document_links: [
    {
      id: releasedRestrictedLinkId,
      organization_id: ORGANIZATION_A,
      document_id: releasedRestrictedDocumentId,
      client_id: ownClientId,
    },
  ],
  clients: [
    { id: foreignClientId, organization_id: ORGANIZATION_B },
    { id: ownClientId, organization_id: ORGANIZATION_A },
  ],
  client_requests: [{ id: foreignRequestId, organization_id: ORGANIZATION_B }],
  installed_equipment: [{ id: foreignEquipmentId, organization_id: ORGANIZATION_B }],
  service_cases: [{ id: foreignServiceCaseId, organization_id: ORGANIZATION_B }],
  maintenance_coverages: [{ id: foreignCoverageId, organization_id: ORGANIZATION_B }],
  organization_members: [{ user_id: foreignMemberId, organization_id: ORGANIZATION_B, role: 'employee' }],
});
// Storage stands in so a write that passes authorization signs no real URL; a refusal never reaches it.
const storageCalls: string[] = [];
const recordStorage =
  (name: string) =>
  async (...args: unknown[]) => {
    storageCalls.push(name);
    return name === 'createSignedUploadUrl' ? 'https://storage.example.test/upload' : args;
  };
mock.module('@/lib/storage/r2', () => ({
  copyStorageObject: recordStorage('copyStorageObject'),
  createSignedDownloadUrl: recordStorage('createSignedDownloadUrl'),
  createSignedUploadUrl: recordStorage('createSignedUploadUrl'),
  discardStorageObjects: recordStorage('discardStorageObjects'),
  promoteUploadedObject: recordStorage('promoteUploadedObject'),
  uploadStagingPath: (path: string) => `staging/${path}`,
}));
const {
  getAttachableDocuments,
  getRequestDocuments,
  getDocumentLinkEmployees,
  getClientDocuments,
  getEquipmentDocuments,
  getServiceCaseDocuments,
  getMaintenanceCoverageDocuments,
  getEmployeeDocuments,
  linkDocumentsToTarget,
  permanentlyDeleteDocument,
  unlinkDocument,
  updateDocumentLinks,
} = await import('@/lib/documents/actions');
const { getDocumentFolderOptions, createDocumentFolder, moveDocumentFolder, copyDocumentFolder } =
  await import('@/lib/documents/folder-actions');
const {
  copyDocument,
  deleteDocument,
  moveDocument,
  renameDocument,
  restoreDocument,
  updateDocumentCategory,
} = await import('@/lib/documents/library-actions');
const { createDocumentVersionUploadTicket, finalizeDocumentVersionUpload } = await import(
  '@/lib/documents/upload-actions'
);

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
    'renameDocument',
    () => renameDocument({ documentId: foreignDocumentId, displayName: 'neu.pdf' }),
    'document_not_found',
  ],
  [
    'updateDocumentCategory',
    () => updateDocumentCategory({ documentId: foreignDocumentId, category: 'invoice' }),
    'document_not_found',
  ],
  [
    'moveDocument',
    () => moveDocument({ documentId: foreignDocumentId, folderId: ownFolderId }),
    'document_not_found',
  ],
  ['deleteDocument', () => deleteDocument(foreignDocumentId), 'document_not_found'],
  ['updateDocumentLinks', () => updateDocumentLinks({ documentId: foreignDocumentId }), 'document_not_found'],
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
        uploadId: '8e000000-0000-4000-8000-0000000000ff',
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

// Büro neither restores nor deletes a trashed Admin-only personnel document,
// and restores a standard one; an Admin restores the Admin-only one.
await assertRefused(
  world,
  [
    ['restoreDocument', () => restoreDocument(restrictedDeletedDocumentId)],
    ['permanentlyDeleteDocument', () => permanentlyDeleteDocument(restrictedDeletedDocumentId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);
// A failed protection read refuses too; it never counts as an unprotected document.
world.failingTables.add('personnel_documents');
await assertRefused(
  world,
  [
    ['restoreDocument', () => restoreDocument(restrictedDeletedDocumentId)],
    ['permanentlyDeleteDocument', () => permanentlyDeleteDocument(restrictedDeletedDocumentId)],
  ],
  { success: false, error: 'load_failed' },
  'reads',
);
world.failingTables.delete('personnel_documents');
for (const [role, documentId] of [
  ['buero', standardDeletedDocumentId],
  ['admin', restrictedDeletedDocumentId],
] as const) {
  signInAs(world, role);
  world.rpcCalls.length = 0;
  assert.deepEqual(await restoreDocument(documentId), { success: true }, `${role} restore failed`);
  assert.deepEqual(
    world.rpcCalls.map((call) => call.name),
    ['restore_document'],
  );
}

// Every document write of one document, by name.
const documentWrites = (documentId: string) =>
  [
    ['renameDocument', () => renameDocument({ documentId, displayName: 'neu.pdf' })],
    ['updateDocumentCategory', () => updateDocumentCategory({ documentId, category: 'invoice' })],
    [
      'createDocumentVersionUploadTicket',
      () =>
        createDocumentVersionUploadTicket({
          documentId,
          fileName: 'vertrag.pdf',
          fileSizeBytes: 2048,
          mimeType: 'application/pdf',
        }),
    ],
    [
      'finalizeDocumentVersionUpload',
      () =>
        finalizeDocumentVersionUpload({
          documentId,
          versionNumber: 2,
          uploadId: '8e000000-0000-4000-8000-0000000000ff',
          fileName: 'vertrag.pdf',
        }),
    ],
    ['deleteDocument', () => deleteDocument(documentId)],
    ['moveDocument', () => moveDocument({ documentId, folderId: ownFolderId })],
    ['copyDocument', () => copyDocument({ documentId })],
    ['updateDocumentLinks', () => updateDocumentLinks({ documentId, addClientIds: [ownClientId] })],
  ] as const;

// Büro reads a released Admin-only personnel document about themselves, but no
// write changes it, its links or its versions: each is refused before any
// database function or storage call.
signInAs(world, 'buero');
storageCalls.length = 0;
for (const documentId of [releasedRestrictedDocumentId, releasedHealthDocumentId]) {
  await assertRefused(
    world,
    documentWrites(documentId),
    { success: false, error: 'not_authorized' },
    'reads',
  );
}
await assertRefused(
  world,
  [['unlinkDocument', () => unlinkDocument({ linkId: releasedRestrictedLinkId })]],
  { success: false, error: 'not_authorized' },
  'reads',
);
assert.deepEqual(
  await linkDocumentsToTarget({ documentIds: [releasedRestrictedDocumentId], clientId: ownClientId }),
  { success: false, error: 'link_failed', linkedCount: 0, failedCount: 1 },
);
assert.equal(world.rpcCalls.length, 0, 'linkDocumentsToTarget reached a database function');
assert.deepEqual(storageCalls, [], 'a refused write reached storage');

// An Admin still renames, reclassifies, versions and trashes an Admin-only
// personnel document, and Büro a standard one: each write reaches its function.
for (const [role, documentId] of [
  ['admin', releasedRestrictedDocumentId],
  ['buero', ownStandardDocumentId],
] as const) {
  signInAs(world, role);
  world.rpcCalls.length = 0;
  storageCalls.length = 0;
  await renameDocument({ documentId, displayName: 'neu.pdf' });
  await updateDocumentCategory({ documentId, category: 'invoice' });
  await deleteDocument(documentId);
  const ticket = await createDocumentVersionUploadTicket({
    documentId,
    fileName: 'vertrag.pdf',
    fileSizeBytes: 2048,
    mimeType: 'application/pdf',
  });
  assert.ok(ticket.success, `${role}: the version ticket was refused`);
  assert.deepEqual(
    world.rpcCalls.map((call) => call.name),
    ['rename_document', 'update_document_category', 'trash_document'],
    `${role}: a write did not reach its function`,
  );
  assert.deepEqual(storageCalls, ['createSignedUploadUrl'], `${role}: the version ticket was not signed`);
}
