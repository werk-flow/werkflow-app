// The real document and folder readers over the in-memory database: a person
// who has left the organization stays named as uploader, folder creator and
// audit actor, but the reader gets neither their current email nor their
// avatar path, and the same holds for whoever filed a document. A current
// member keeps the full reference. The office reads the
// library, the folder options and the document details; an assigned field
// worker reads the job's documents. Another organization's document and job
// stay unreachable, and a failed membership read fails the reader instead of
// exposing the person.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';

const formerMemberId = '95000000-0000-4000-8000-000000000001';
const jobId = '95100000-0000-4000-8000-000000000001';
const foreignJobId = '95100000-0000-4000-8000-000000000009';
const formerDocumentId = '95200000-0000-4000-8000-000000000001';
const currentDocumentId = '95200000-0000-4000-8000-000000000002';
const foreignDocumentId = '95200000-0000-4000-8000-000000000009';
const formerFolderId = '95300000-0000-4000-8000-000000000001';
const currentFolderId = '95300000-0000-4000-8000-000000000002';
const now = '2026-10-01T08:00:00.000Z';

const documentRow = (id: string, organizationId: string, uploadedBy: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  category: 'contract',
  created_at: now,
  updated_at: now,
  current_version_number: 2,
  display_name: `Vertrag ${id.slice(-3)}.pdf`,
  original_file_name: 'vertrag.pdf',
  size_bytes: 1024,
  storage_bucket: 'organization-documents',
  storage_path: `${organizationId}/${id}/vertrag.pdf`,
  uploaded_by: uploadedBy,
  copied_from_document_id: null,
  delete_reason: null,
  deleted_at: null,
  deleted_by: null,
  folder_id: null,
  metadata: {},
  mime_type: 'application/pdf',
  document_date: '2026-10-01',
  retention_class: 'ten_years',
  retention_ends_on: '2036-12-31',
  // Whoever uploaded a document also filed it.
  filed_at: now,
  filed_by: uploadedBy,
});
const folderRow = (id: string, createdBy: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  parent_folder_id: null,
  name: `Ordner ${id.slice(-3)}`,
  created_by: createdBy,
  created_at: now,
  updated_at: now,
  deleted_at: null,
});
const versionRow = (versionNumber: number, uploadedBy: string) => ({
  id: `95400000-0000-4000-8000-00000000000${versionNumber}`,
  organization_id: ORGANIZATION_A,
  document_id: formerDocumentId,
  version_number: versionNumber,
  storage_bucket: 'organization-documents',
  storage_path: `${ORGANIZATION_A}/${formerDocumentId}/v${versionNumber}.pdf`,
  original_file_name: `vertrag-v${versionNumber}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1024,
  uploaded_by: uploadedBy,
  created_at: `2026-10-0${versionNumber}T08:00:00.000Z`,
});
const auditRow = (index: number, actorId: string) => ({
  id: `95500000-0000-4000-8000-00000000000${index}`,
  organization_id: ORGANIZATION_A,
  document_id: formerDocumentId,
  folder_id: null,
  actor_id: actorId,
  event_type: 'uploaded',
  event_payload: {},
  created_at: `2026-10-0${index}T08:00:00.000Z`,
});
const linkRow = (documentId: string, organizationId: string, linkedJobId: string) => ({
  id: crypto.randomUUID(),
  organization_id: organizationId,
  document_id: documentId,
  created_at: now,
  created_by: CALLER_ID,
  job_id: linkedJobId,
  project_id: null,
  client_id: null,
  employee_id: null,
  request_id: null,
  equipment_id: null,
  service_case_id: null,
  maintenance_coverage_id: null,
});
const assignment = (id: string, organizationId: string) => ({
  id: crypto.randomUUID(),
  organization_id: organizationId,
  job_id: id,
  user_id: CALLER_ID,
});
// The in-memory database has no joins: a job carries its assignments as an embedded array.
const jobRow = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  job_number: `A-${id.slice(-3)}`,
  title: 'Heizung warten',
  project_id: null,
  client_id: null,
  job_assignments: [assignment(id, organizationId)],
});

const documents = [
  documentRow(formerDocumentId, ORGANIZATION_A, formerMemberId),
  documentRow(currentDocumentId, ORGANIZATION_A, CALLER_ID),
  documentRow(foreignDocumentId, ORGANIZATION_B, formerMemberId),
];
const world = installActionWorld({
  jobs: [jobRow(jobId, ORGANIZATION_A), jobRow(foreignJobId, ORGANIZATION_B)],
  job_assignments: [assignment(jobId, ORGANIZATION_A), assignment(foreignJobId, ORGANIZATION_B)],
  // The former member left organization A and now works for organization B.
  organization_members: [
    { id: 'member-caller', organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' },
    { id: 'member-elsewhere', organization_id: ORGANIZATION_B, user_id: formerMemberId, role: 'admin' },
  ],
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Bea',
      last_name: 'Büro',
      email: 'bea@example.test',
      avatar_path: 'avatars/bea.png',
    },
    {
      id: formerMemberId,
      first_name: 'Erik',
      last_name: 'Ehemalig',
      email: 'erik.neu@example.test',
      avatar_path: 'avatars/erik.png',
    },
  ],
  documents,
  ordinary_documents: documents,
  personnel_documents: [],
  document_folders: [folderRow(formerFolderId, formerMemberId), folderRow(currentFolderId, CALLER_ID)],
  document_versions: [versionRow(1, formerMemberId), versionRow(2, CALLER_ID)],
  document_audit_events: [auditRow(1, formerMemberId), auditRow(2, CALLER_ID)],
  document_links: [
    linkRow(formerDocumentId, ORGANIZATION_A, jobId),
    linkRow(currentDocumentId, ORGANIZATION_A, jobId),
    linkRow(foreignDocumentId, ORGANIZATION_B, foreignJobId),
  ],
});
world.rpc = ({ name, args }) => {
  if (name === 'list_profile_references') return listProfileReferencesInWorld(world, args);
  // The library page selects the organization's documents; `supabase/tests/operational_list_pages.sql` tests its SQL.
  assert.equal(name, 'list_document_page');
  assert.equal(args.p_organization_id, ORGANIZATION_A);
  return { data: { ids: [formerDocumentId, currentDocumentId], total: 2 }, error: null };
};

const { getDocumentDetails, getJobDocuments } = await import('@/lib/documents/actions');
const { getDocumentLibrary } = await import('@/lib/documents/library-actions');
const { getDocumentFolderOptions } = await import('@/lib/documents/folder-actions');

const formerMember = {
  userId: formerMemberId,
  firstName: 'Erik',
  lastName: 'Ehemalig',
  email: null,
  avatarPath: null,
};
const currentMember = {
  userId: CALLER_ID,
  firstName: 'Bea',
  lastName: 'Büro',
  email: 'bea@example.test',
  avatarPath: 'avatars/bea.png',
};
const rule = 'a former member keeps only the name; a current member keeps the full reference';

/** The uploader of each document, in the order of the document ids above. */
function uploaders(result: unknown, label: string): unknown[] {
  assert.ok(typeof result === 'object' && result !== null, `${label}: no result`);
  assert.equal(Reflect.get(result, 'success'), true, `${label}: ${JSON.stringify(result)}`);
  const listed: unknown = Reflect.get(result, 'documents');
  assert.ok(Array.isArray(listed), `${label}: no documents`);
  return [formerDocumentId, currentDocumentId].map(
    (id) => listed.find((document) => document.id === id)?.uploader,
  );
}

signInAs(world, 'buero');

// The library names the former uploader, filer and folder creator by name only.
const library = await getDocumentLibrary({ view: 'folders' });
assert.deepEqual(uploaders(library, 'library'), [formerMember, currentMember], `library: ${rule}`);
assert.ok(library.success);
assert.deepEqual(
  [formerDocumentId, currentDocumentId].map(
    (id) => library.documents.find((document) => document.id === id)?.archive?.filer,
  ),
  [formerMember, currentMember],
  `library filers: ${rule}`,
);
assert.deepEqual(
  [formerFolderId, currentFolderId].map((id) => library.folders.find((folder) => folder.id === id)?.creator),
  [formerMember, currentMember],
  `library folders: ${rule}`,
);

// The folder options name them the same way.
const folderOptions = await getDocumentFolderOptions();
assert.ok(folderOptions.success, JSON.stringify(folderOptions));
assert.deepEqual(
  [formerFolderId, currentFolderId].map(
    (id) => folderOptions.folders.find((folder) => folder.id === id)?.creator,
  ),
  [formerMember, currentMember],
  `folder options: ${rule}`,
);

// The details name the uploader, each version's uploader and each audit actor the same way.
const details = await getDocumentDetails(formerDocumentId);
assert.ok(details.success, JSON.stringify(details));
assert.deepEqual(
  [details.document.uploader, details.document.archive?.filer],
  [formerMember, formerMember],
  `details: ${rule}`,
);
assert.deepEqual(
  // The in-memory database ignores `order`; the version number orders the comparison.
  details.versions
    .map((version) => [version.versionNumber, version.uploader])
    .sort(([left], [right]) => Number(left) - Number(right)),
  [
    [1, formerMember],
    [2, currentMember],
  ],
  `versions: ${rule}`,
);
assert.deepEqual(
  [CALLER_ID, formerMemberId].map(
    (actorId) => details.auditEvents.find((event) => event.actorId === actorId)?.actor,
  ),
  [currentMember, formerMember],
  `audit history: ${rule}`,
);

// The assigned field worker reads the job's documents with the same references.
signInAs(world, 'employee');
assert.deepEqual(
  uploaders(await getJobDocuments(jobId), 'job documents'),
  [formerMember, currentMember],
  `job documents: ${rule}`,
);

// Another organization's job and document stay unknown, as before.
assert.deepEqual(await getJobDocuments(foreignJobId), { success: false, error: 'job_not_found' });
signInAs(world, 'buero');
assert.deepEqual(await getDocumentDetails(foreignDocumentId), {
  success: false,
  error: 'document_not_found',
});

// Membership is asked only for the reader's own organization, never for one the record does not belong to.
for (const call of world.rpcCalls.filter((rpc) => rpc.name === 'list_profile_references'))
  assert.equal(call.args.p_organization_id, ORGANIZATION_A);

// Without the membership read a reader cannot tell who left, so it fails.
world.rpc = ({ name }) =>
  name === 'list_profile_references'
    ? { data: null, error: { code: '08006', message: 'connection failure' } }
    : { data: { ids: [formerDocumentId], total: 1 }, error: null };
assert.equal((await getDocumentLibrary({ view: 'folders' })).success, false, 'library without membership');
assert.equal((await getDocumentFolderOptions()).success, false, 'folder options without membership');
// The details throw on a failed hydration, as before; the caller shows its error state.
assert.equal(
  await getDocumentDetails(formerDocumentId).then(
    (result) => result.success,
    () => false,
  ),
  false,
  'details without membership',
);
signInAs(world, 'employee');
assert.equal((await getJobDocuments(jobId)).success, false, 'job documents without membership');
