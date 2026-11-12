// The actual document and version upload actions over the in-memory database
// and an in-memory bucket behind the actual storage adapter. A staged upload
// belongs to the person whose session created its ticket: a coworker of the
// same organization with access to the target, who knows the document id (and
// for a version the upload id), finalizes nothing and leaves the bytes where
// the creator's next try finds them. A member of another organization does
// neither. No call names the creator; the server alone binds the upload.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';
import { installInMemoryBucket } from './in-memory-bucket';

const bucket = installInMemoryBucket();
const jobId = '8f100000-0000-4000-8000-000000000020';
const contractId = '8f100000-0000-4000-8000-000000000021';
const COWORKER_ID = '30000000-0000-4000-8000-000000000002';
const contractPath = `${ORGANIZATION_A}/${contractId}/vertrag.pdf`;
const now = '2026-10-01T08:00:00.000Z';
const contract: Record<string, unknown> = {
  id: contractId,
  organization_id: ORGANIZATION_A,
  folder_id: null,
  storage_bucket: 'organization-documents',
  storage_path: contractPath,
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
  jobs: [{ id: jobId, organization_id: ORGANIZATION_A, project_id: null }],
  job_assignments: [CALLER_ID, COWORKER_ID].map((userId, index) => ({
    id: `8f100000-0000-4000-8000-00000000003${index}`,
    organization_id: ORGANIZATION_A,
    job_id: jobId,
    user_id: userId,
  })),
  documents: [contract],
  document_versions: [],
  document_folders: [],
  document_links: [],
  personnel_documents: [],
  profiles: [],
});
world.rpc = ({ name, args }) => {
  if (name === 'list_profile_references') return listProfileReferencesInWorld(world, args);
  if (name === 'finalize_document_upload') {
    return {
      data: {
        ...contract,
        id: String(args.p_document_id),
        category: 'photo',
        storage_path: String(args.p_storage_path),
        original_file_name: 'foto-1.png',
        display_name: 'foto-1.png',
        mime_type: 'image/png',
        uploaded_by: String(args.p_actor_id),
      },
      error: null,
    };
  }
  if (name === 'finalize_document_version_upload') {
    return {
      data: {
        ...contract,
        storage_path: String(args.p_storage_path),
        current_version_number: 2,
        uploaded_by: String(args.p_actor_id),
      },
      error: null,
    };
  }
  return { data: null, error: { message: `${name} is outside this fixture` } };
};

const { uploadStagingPath } = await import('@/lib/storage/r2');
const {
  createDocumentUploadTicket,
  createDocumentVersionUploadTicket,
  finalizeDocumentUpload,
  finalizeDocumentVersionUpload,
} = await import('@/lib/documents/upload-actions');

const png = { body: 'png-data', contentType: 'image/png' };
const pdf = { body: 'pdf-data', contentType: 'application/pdf' };

/** Signs in as `userId` with `role` in `orgId`. */
function signInAsPerson(userId: string, role: 'employee' | 'buero', orgId: string = ORGANIZATION_A): void {
  signInAs(world, role, orgId);
  world.callerId = userId;
}

const registrations = (name: string) => world.rpcCalls.filter((call) => call.name === name);

// The creator stages a photo on the job; the bytes wait in the staging key.
signInAsPerson(CALLER_ID, 'employee');
const ticket = await createDocumentUploadTicket({
  kind: 'job',
  jobId,
  fileName: 'foto-1.png',
  fileSizeBytes: 8,
  mimeType: 'image/png',
});
assert.ok(ticket.success, JSON.stringify(ticket));
const stagingPath = uploadStagingPath(ORGANIZATION_A, ticket.ticket.storagePath);
bucket.set(stagingPath, png);
const finalizePhoto = (target: { kind: 'job'; jobId: string } | { kind: 'library' }) =>
  finalizeDocumentUpload({
    ...target,
    documentId: ticket.ticket.documentId,
    fileName: 'foto-1.png',
    category: 'photo',
  });

// A coworker assigned to the same job finalizes the creator's ticket.
signInAsPerson(COWORKER_ID, 'employee');
assert.deepEqual(
  await finalizePhoto({ kind: 'job', jobId }),
  { success: false, error: 'file_missing' },
  "a coworker of the same organization registered another person's staged upload",
);
// A member of another organization finalizes it into their own library.
signInAsPerson(COWORKER_ID, 'buero', ORGANIZATION_B);
assert.deepEqual(
  await finalizePhoto({ kind: 'library' }),
  { success: false, error: 'file_missing' },
  "a member of another organization registered a foreign organization's staged upload",
);
assert.equal(registrations('finalize_document_upload').length, 0, 'a refused finalize registered the photo');
assert.deepEqual(
  [...bucket.keys()],
  [stagingPath],
  "a refused finalize copied or removed the creator's staged bytes",
);

// The creator's own finalize registers the photo as before.
signInAsPerson(CALLER_ID, 'employee');
const own = await finalizePhoto({ kind: 'job', jobId });
assert.equal(own.success, true, JSON.stringify(own));
assert.equal(registrations('finalize_document_upload')[0]?.args.p_actor_id, CALLER_ID);

// The same binding holds for a new version: an office member stages version 2 of a contract.
bucket.set(contractPath, pdf);
signInAsPerson(CALLER_ID, 'buero');
const versionTicket = await createDocumentVersionUploadTicket({
  documentId: contractId,
  fileName: 'vertrag-v2.pdf',
  fileSizeBytes: 8,
  mimeType: 'application/pdf',
});
assert.ok(versionTicket.success, JSON.stringify(versionTicket));
const versionStagingPath = uploadStagingPath(ORGANIZATION_A, versionTicket.ticket.storagePath);
bucket.set(versionStagingPath, pdf);
const finalizeVersion = () =>
  finalizeDocumentVersionUpload({
    documentId: contractId,
    versionNumber: versionTicket.ticket.versionNumber,
    uploadId: versionTicket.ticket.uploadId,
    fileName: 'vertrag-v2.pdf',
  });

signInAsPerson(COWORKER_ID, 'buero');
assert.deepEqual(
  await finalizeVersion(),
  { success: false, error: 'file_missing' },
  "an office coworker saved another person's staged version",
);
signInAsPerson(COWORKER_ID, 'buero', ORGANIZATION_B);
assert.deepEqual(
  await finalizeVersion(),
  { success: false, error: 'document_not_found' },
  "a member of another organization reached a foreign organization's document",
);
assert.equal(
  registrations('finalize_document_version_upload').length,
  0,
  'a refused finalize saved the version',
);
assert.ok(
  bucket.has(versionStagingPath),
  "a refused finalize copied or removed the creator's staged version",
);

signInAsPerson(CALLER_ID, 'buero');
const ownVersion = await finalizeVersion();
assert.equal(ownVersion.success, true, JSON.stringify(ownVersion));
assert.equal(registrations('finalize_document_version_upload')[0]?.args.p_actor_id, CALLER_ID);
