// The actual version finalize over the in-memory database and an in-memory
// bucket behind the actual storage adapter. A manager files the document
// after the version ticket: the finalize is refused as `document_filed`
// before the copy, deletes that ticket's staging object, and leaves the
// registered file and another upload's staging object as they were.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { installInMemoryBucket } from './in-memory-bucket';

const bucket = installInMemoryBucket();
const contractId = '8e000000-0000-4000-8000-000000000011';
const otherDocumentId = '8e000000-0000-4000-8000-000000000012';
const registeredPath = `${ORGANIZATION_A}/${contractId}/vertrag.pdf`;
const now = '2026-10-01T08:00:00.000Z';
const contract: Record<string, unknown> = {
  id: contractId,
  organization_id: ORGANIZATION_A,
  folder_id: null,
  storage_bucket: 'organization-documents',
  storage_path: registeredPath,
  original_file_name: 'vertrag.pdf',
  display_name: 'vertrag.pdf',
  category: 'contract',
  mime_type: 'application/pdf',
  size_bytes: 8,
  current_version_number: 1,
  uploaded_by: CALLER_ID,
  deleted_at: null,
  filed_at: null,
  filed_by: null,
  created_at: now,
  updated_at: now,
};

const world = installActionWorld({
  documents: [contract],
  document_folders: [],
  document_links: [],
  personnel_documents: [],
  profiles: [],
});
world.rpc = ({ name }) => ({ data: null, error: { message: `${name} is outside this fixture` } });

const { uploadStagingPath } = await import('@/lib/storage/r2');
const { createDocumentVersionUploadTicket, finalizeDocumentVersionUpload } = await import(
  '@/lib/documents/upload-actions'
);

const pdf = (body: string) => ({ body, contentType: 'application/pdf' });

signInAs(world, 'buero');
const ticket = await createDocumentVersionUploadTicket({
  documentId: contractId,
  fileName: 'vertrag-v2.pdf',
  fileSizeBytes: 8,
  mimeType: 'application/pdf',
});
assert.ok(ticket.success, JSON.stringify(ticket));

const ownStagingPath = uploadStagingPath(ORGANIZATION_A, ticket.ticket.storagePath);
const otherStagingPath = uploadStagingPath(
  ORGANIZATION_A,
  `${ORGANIZATION_A}/${otherDocumentId}/aufmass.pdf`,
);
bucket.set(registeredPath, pdf('filed original'));
bucket.set(ownStagingPath, pdf('version 2'));
bucket.set(otherStagingPath, pdf('another upload'));

// Another manager files the document while the version's bytes are on their way.
contract.filed_at = '2026-10-01T09:00:00.000Z';
contract.filed_by = CALLER_ID;

assert.deepEqual(
  await finalizeDocumentVersionUpload({
    documentId: contractId,
    versionNumber: ticket.ticket.versionNumber,
    fileName: 'vertrag-v2.pdf',
  }),
  { success: false, error: 'document_filed' },
);
assert.equal(world.rpcCalls.length, 0, 'a finalize of a filed document reached the database function');
assert.equal(bucket.has(ownStagingPath), false, 'the refused upload left its staging object');
assert.deepEqual(bucket.get(registeredPath), pdf('filed original'), 'the filed file changed');
assert.deepEqual(bucket.get(otherStagingPath), pdf('another upload'), "another upload's staging object went");
assert.deepEqual([...bucket.keys()].sort(), [otherStagingPath, registeredPath].sort());
