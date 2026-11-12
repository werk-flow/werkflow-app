// The actual document upload finalize over the in-memory database and an
// in-memory bucket. A finalize that names the person who started the upload
// (`expectedUploaderId`, as a phone's report draft does) is refused when the
// session belongs to someone else, also a member of the same organization
// with access to the job, and registers nothing. The id only refuses; the
// same call without it, or with the session's own id, registers as before.
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
const jobId = '8f000000-0000-4000-8000-000000000020';
const authorId = '8f000000-0000-4000-8000-000000000099';
const now = '2026-10-01T08:00:00.000Z';

const world = installActionWorld({
  jobs: [{ id: jobId, organization_id: ORGANIZATION_A, project_id: null }],
  job_assignments: [
    {
      id: '8f000000-0000-4000-8000-000000000030',
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      user_id: CALLER_ID,
    },
    {
      id: '8f000000-0000-4000-8000-000000000031',
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      user_id: authorId,
    },
  ],
  documents: [],
  document_folders: [],
  document_links: [],
  personnel_documents: [],
  profiles: [],
});
world.rpc = ({ name, args }) => {
  if (name === 'list_profile_references') return listProfileReferencesInWorld(world, args);
  assert.equal(name, 'finalize_document_upload');
  return {
    data: {
      id: String(args.p_document_id),
      organization_id: ORGANIZATION_A,
      folder_id: null,
      storage_bucket: 'organization-documents',
      storage_path: String(args.p_storage_path),
      original_file_name: 'foto-1.png',
      display_name: 'foto-1.png',
      category: 'photo',
      mime_type: 'image/png',
      size_bytes: 8,
      uploaded_by: CALLER_ID,
      deleted_at: null,
      created_at: now,
      updated_at: now,
      current_version_number: 1,
    },
    error: null,
  };
};

const { uploadStagingPath } = await import('@/lib/storage/r2');
const { createDocumentUploadTicket, finalizeDocumentUpload } = await import('@/lib/documents/upload-actions');

/** A ticket for one photo on the job, with its bytes in the staging key as the browser's PUT leaves them. */
async function stagedPhoto(): Promise<{ documentId: string; stagingPath: string }> {
  const ticket = await createDocumentUploadTicket({
    kind: 'job',
    jobId,
    fileName: 'foto-1.png',
    fileSizeBytes: 8,
    mimeType: 'image/png',
  });
  assert.ok(ticket.success, JSON.stringify(ticket));
  const stagingPath = uploadStagingPath(ORGANIZATION_A, ticket.ticket.storagePath);
  bucket.set(stagingPath, { body: 'png-data', contentType: 'image/png' });
  return { documentId: ticket.ticket.documentId, stagingPath };
}

// The session is a coworker with access to the job; the upload was the author's.
signInAs(world, 'employee');
const foreign = await stagedPhoto();
assert.deepEqual(
  await finalizeDocumentUpload({
    kind: 'job',
    jobId,
    documentId: foreign.documentId,
    fileName: 'foto-1.png',
    category: 'photo',
    expectedUploaderId: authorId,
  }),
  { success: false, error: 'uploader_changed' },
);
const registrations = () => world.rpcCalls.filter((call) => call.name === 'finalize_document_upload').length;
assert.equal(registrations(), 0, 'a refused finalize registered the photo');
assert.deepEqual(
  [...bucket.keys()],
  [foreign.stagingPath],
  'a refused finalize copied the photo, or dropped the bytes the author still registers',
);

// Without the parameter, and with the session's own id, the finalize registers as before.
for (const expected of [{}, { expectedUploaderId: CALLER_ID }]) {
  const own = await stagedPhoto();
  const result = await finalizeDocumentUpload({
    kind: 'job',
    jobId,
    documentId: own.documentId,
    fileName: 'foto-1.png',
    category: 'photo',
    ...expected,
  });
  assert.equal(result.success, true, JSON.stringify(result));
}
assert.equal(registrations(), 2);

// A malformed id is refused as invalid input, never treated as absent.
const malformed = await stagedPhoto();
assert.deepEqual(
  await finalizeDocumentUpload({
    kind: 'job',
    jobId,
    documentId: malformed.documentId,
    fileName: 'foto-1.png',
    expectedUploaderId: 'not-a-uuid',
  }),
  { success: false, error: 'invalid_input' },
);
