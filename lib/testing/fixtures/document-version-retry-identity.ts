// The actual version ticket and finalize over the in-memory database and an
// in-memory bucket behind the actual storage adapter. The database function
// stand-in commits like `finalize_document_version_upload`: it refuses a stale
// version number, archives the current file and makes the upload current.
// A retry whose earlier answer got lost finds its own saved version, current
// or archived, and reports it saved, also after the document was filed or
// recategorized. A version another upload saved under the
// same number and file name, by another person or by the same person in
// another tab, never counts as the retry's.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { installInMemoryBucket } from './in-memory-bucket';

const bucket = installInMemoryBucket();
const contractId = '8e000000-0000-4000-8000-000000000021';
const COLLEAGUE_ID = '30000000-0000-4000-8000-000000000002';
const originalPath = `${ORGANIZATION_A}/${contractId}/vertrag.pdf`;
const now = '2026-10-01T08:00:00.000Z';
const contract: Record<string, unknown> = {
  id: contractId,
  organization_id: ORGANIZATION_A,
  folder_id: null,
  storage_bucket: 'organization-documents',
  storage_path: originalPath,
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
const versions: Record<string, unknown>[] = [];

const world = installActionWorld({
  documents: [contract],
  document_versions: versions,
  document_folders: [],
  document_links: [],
  personnel_documents: [],
  profiles: [],
});
world.rpc = ({ name, args }) => {
  if (name !== 'finalize_document_version_upload') {
    return { data: null, error: { message: `${name} is outside this fixture` } };
  }
  if (contract.current_version_number !== args.p_expected_version_number) {
    return { data: null, error: { code: 'P0001', message: 'version_conflict' } };
  }
  versions.push({
    id: `8e000000-0000-4000-8000-0000000001${String(versions.length).padStart(2, '0')}`,
    organization_id: ORGANIZATION_A,
    document_id: contractId,
    version_number: contract.current_version_number,
    storage_bucket: contract.storage_bucket,
    storage_path: contract.storage_path,
    original_file_name: contract.original_file_name,
    mime_type: contract.mime_type,
    size_bytes: contract.size_bytes,
    uploaded_by: contract.uploaded_by,
    created_at: now,
  });
  Object.assign(contract, {
    current_version_number: Number(contract.current_version_number) + 1,
    storage_path: args.p_storage_path,
    original_file_name: args.p_original_file_name,
    mime_type: args.p_mime_type,
    size_bytes: args.p_size_bytes,
    uploaded_by: args.p_actor_id,
  });
  return { data: structuredClone(contract), error: null };
};

const { uploadStagingPath } = await import('@/lib/storage/r2');
const { createDocumentVersionUploadTicket, finalizeDocumentVersionUpload } = await import(
  '@/lib/documents/upload-actions'
);

const pdf = (body: string) => ({ body, contentType: 'application/pdf' });

/** Signs in as `userId` with the Büro role of organization A. */
function signInAsOfficeMember(userId: string): void {
  signInAs(world, 'buero');
  world.callerId = userId;
}

/** A version ticket for `vertrag-v2.pdf` whose bytes reached storage. */
async function transferVersion(body: string) {
  const result = await createDocumentVersionUploadTicket({
    documentId: contractId,
    fileName: 'vertrag-v2.pdf',
    fileSizeBytes: 8,
    mimeType: 'application/pdf',
  });
  assert.ok(result.success, JSON.stringify(result));
  bucket.set(uploadStagingPath(ORGANIZATION_A, result.ticket.storagePath), pdf(body));
  return result.ticket;
}

function finalize(ticket: { versionNumber: number; uploadId: string }) {
  return finalizeDocumentVersionUpload({
    documentId: contractId,
    versionNumber: ticket.versionNumber,
    uploadId: ticket.uploadId,
    fileName: 'vertrag-v2.pdf',
  });
}

bucket.set(originalPath, pdf('version 1'));

// The first try commits version 2, but its answer never reaches the browser.
signInAsOfficeMember(CALLER_ID);
const ours = await transferVersion('ours');
assert.ok((await finalize(ours)).success, 'the first finalize did not commit');
const oursPath = String(contract.storage_path);
assert.deepEqual(
  await finalize(ours),
  { success: false, error: 'already_finalized' },
  'a retry after its own committed save did not report it saved',
);
assert.equal(contract.current_version_number, 2, 'the retry saved another version');
assert.deepEqual(bucket.get(oursPath), pdf('ours'), 'the retry changed the saved file');

// Another person's version 3 under the same file name archives ours: the retry still finds its own.
signInAsOfficeMember(COLLEAGUE_ID);
const colleagues = await transferVersion('colleague');
assert.ok((await finalize(colleagues)).success, "the colleague's finalize did not commit");
const colleaguesPath = String(contract.storage_path);
signInAsOfficeMember(CALLER_ID);
assert.deepEqual(
  await finalize(ours),
  { success: false, error: 'already_finalized' },
  'a retry after its own save was archived did not report it saved',
);

// Our next upload's first try never reaches the database; meanwhile the colleague saves version 4.
const lost = await transferVersion('lost');
signInAsOfficeMember(COLLEAGUE_ID);
const colleaguesNext = await transferVersion('colleague next');
assert.ok((await finalize(colleaguesNext)).success, "the colleague's next finalize did not commit");
const colleaguesNextPath = String(contract.storage_path);
signInAsOfficeMember(CALLER_ID);
assert.deepEqual(
  await finalize(lost),
  { success: false, error: 'version_conflict' },
  "a retry counted another person's version with its number and file name as its own",
);

// The same person saves version 5 from another tab; the first tab's upload of version 5 never counts it.
const firstTab = await transferVersion('first tab');
const secondTab = await transferVersion('second tab');
assert.ok((await finalize(secondTab)).success, "the second tab's finalize did not commit");
const secondTabPath = String(contract.storage_path);
assert.deepEqual(
  await finalize(firstTab),
  { success: false, error: 'version_conflict' },
  'a retry counted another upload of the same person as its own',
);

// The second tab's retry still finds its saved version after a manager filed the
// document, and after the category changed to one without versions.
contract.filed_at = '2026-10-01T09:00:00.000Z';
contract.filed_by = COLLEAGUE_ID;
assert.deepEqual(
  await finalize(secondTab),
  { success: false, error: 'already_finalized' },
  'a retry after its own save failed once the document was filed',
);
assert.deepEqual(
  await finalize(firstTab),
  { success: false, error: 'document_filed' },
  "a retry of a filed document counted another upload's version as its own",
);
Object.assign(contract, { filed_at: null, filed_by: null, category: 'photo' });
assert.deepEqual(
  await finalize(secondTab),
  { success: false, error: 'already_finalized' },
  'a retry after its own save failed once the category took no versions',
);

assert.equal(contract.current_version_number, 5);
assert.deepEqual(
  [...bucket.keys()].sort(),
  [originalPath, oursPath, colleaguesPath, colleaguesNextPath, secondTabPath].sort(),
  'a refused upload left its staging object, or a saved file went',
);
assert.deepEqual(bucket.get(secondTabPath), pdf('second tab'));
