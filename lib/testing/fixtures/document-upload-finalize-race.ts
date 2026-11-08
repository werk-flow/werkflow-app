// The actual document upload and version finalize over the in-memory database
// and an in-memory bucket behind the actual storage adapter. Each scenario
// replays two finalizes of one upload: the second read the database before the
// first committed, and a still-valid signed URL wrote the staging key again in
// between. The file the first finalize registered keeps its bytes, and the
// refused second finalize leaves no object behind. A finalize whose
// registration has an unknown outcome keeps its copy.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';
import { installInMemoryBucket } from './in-memory-bucket';

const bucket = installInMemoryBucket();
const versionedDocumentId = '8e000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';
const documentRow = (fields: { id: string; storage_path: string; current_version_number: number }) => ({
  organization_id: ORGANIZATION_A,
  folder_id: null,
  storage_bucket: 'organization-documents',
  original_file_name: 'vertrag.pdf',
  display_name: 'vertrag.pdf',
  category: 'contract',
  mime_type: 'application/pdf',
  size_bytes: 8,
  uploaded_by: CALLER_ID,
  deleted_at: null,
  created_at: now,
  updated_at: now,
  ...fields,
});

// The tables stay as both finalizes read them: neither commit reaches the second finalize's read.
const world = installActionWorld({
  documents: [
    documentRow({
      id: versionedDocumentId,
      storage_path: `${ORGANIZATION_A}/${versionedDocumentId}/vertrag.pdf`,
      current_version_number: 1,
    }),
  ],
  document_folders: [],
  document_links: [],
  personnel_documents: [],
  profiles: [],
});
// Each finalize function commits its first call; a later call is refused as the committed state refuses it.
const refusalAfterCommit: Record<string, string> = {
  finalize_document_upload: 'already_finalized',
  finalize_document_version_upload: 'version_conflict',
};
world.rpc = ({ name, args }) => {
  if (name === 'list_profile_references') return listProfileReferencesInWorld(world, args);
  const refusal = refusalAfterCommit[name];
  if (!refusal) return { data: null, error: { message: `${name} is outside this fixture` } };
  if (world.rpcCalls.filter((call) => call.name === name).length > 1) {
    return { data: null, error: { code: 'P0001', message: refusal } };
  }
  return {
    data: documentRow({
      id: String(args.p_document_id),
      storage_path: String(args.p_storage_path),
      current_version_number: name === 'finalize_document_version_upload' ? 2 : 1,
    }),
    error: null,
  };
};

const { uploadStagingPath } = await import('@/lib/storage/r2');
const {
  createDocumentUploadTicket,
  createDocumentVersionUploadTicket,
  finalizeDocumentUpload,
  finalizeDocumentVersionUpload,
} = await import('@/lib/documents/upload-actions');

const pdf = (body: string) => ({ body, contentType: 'application/pdf' });

/** Runs both finalizes around a second PUT to the staging key, and checks what the bucket keeps. */
async function finalizeTwice(
  functionName: string,
  stagingPath: string,
  finalize: () => Promise<{ success: boolean; error?: string }>,
  refusal: string,
): Promise<void> {
  bucket.clear();
  bucket.set(stagingPath, pdf('original'));
  const first = await finalize();
  assert.equal(first.error, undefined, `${functionName}: the first finalize failed`);
  const [registration] = world.rpcCalls.filter((call) => call.name === functionName);
  const registeredPath = String(registration?.args.p_storage_path);
  bucket.set(stagingPath, pdf('replaced'));
  assert.deepEqual(await finalize(), { success: false, error: refusal });
  assert.deepEqual(
    bucket.get(registeredPath),
    pdf('original'),
    `${functionName}: a refused finalize changed the registered file`,
  );
  assert.deepEqual([...bucket.keys()], [registeredPath], `${functionName}: an unregistered object was left`);
}

signInAs(world, 'buero');

const ticket = await createDocumentUploadTicket({
  kind: 'library',
  fileName: 'aufmass.pdf',
  fileSizeBytes: 8,
  mimeType: 'application/pdf',
});
assert.ok(ticket.success, JSON.stringify(ticket));
await finalizeTwice(
  'finalize_document_upload',
  uploadStagingPath(ORGANIZATION_A, ticket.ticket.storagePath),
  () =>
    finalizeDocumentUpload({
      kind: 'library',
      documentId: ticket.ticket.documentId,
      fileName: 'aufmass.pdf',
    }),
  'already_finalized',
);

const versionTicket = await createDocumentVersionUploadTicket({
  documentId: versionedDocumentId,
  fileName: 'vertrag.pdf',
  fileSizeBytes: 8,
  mimeType: 'application/pdf',
});
assert.ok(versionTicket.success, JSON.stringify(versionTicket));
await finalizeTwice(
  'finalize_document_version_upload',
  uploadStagingPath(ORGANIZATION_A, versionTicket.ticket.storagePath),
  () =>
    finalizeDocumentVersionUpload({
      documentId: versionedDocumentId,
      versionNumber: versionTicket.ticket.versionNumber,
      uploadId: versionTicket.ticket.uploadId,
      fileName: 'vertrag.pdf',
    }),
  'version_conflict',
);

// A finalize whose registration has an unknown outcome keeps its copy: a
// transport failure arrives while the transaction may still commit.
const unknownTicket = await createDocumentUploadTicket({
  kind: 'library',
  fileName: 'angebot.pdf',
  fileSizeBytes: 8,
  mimeType: 'application/pdf',
});
assert.ok(unknownTicket.success, JSON.stringify(unknownTicket));
bucket.clear();
bucket.set(uploadStagingPath(ORGANIZATION_A, unknownTicket.ticket.storagePath), pdf('original'));
world.rpc = () => ({ data: null, error: { code: '', message: 'TypeError: fetch failed' } });
assert.deepEqual(
  await finalizeDocumentUpload({
    kind: 'library',
    documentId: unknownTicket.ticket.documentId,
    fileName: 'angebot.pdf',
  }),
  { success: false, error: 'create_failed' },
);
const pendingPath = String(world.rpcCalls.at(-1)?.args.p_storage_path);
assert.deepEqual(bucket.get(pendingPath), pdf('original'), 'an unknown outcome removed the copy');
