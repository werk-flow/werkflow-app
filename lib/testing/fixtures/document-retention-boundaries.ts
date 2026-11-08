// The real retention actions over the in-memory database
// (werk-flow/werkflow-planning#283). Filing and the retention change stay
// with Admin and Büro: an employee is refused before any write, and a foreign
// organization's document is not found. A filed document refuses the trash, a
// new version, a retention change and a second filing; a trashed document
// whose period runs, or a filed one, refuses permanent deletion. Each refusal
// comes before the database function and before storage. An employee reads a
// document without its archive data; Admin and Büro read it with.
import { mock, setSystemTime } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

// The Berlin day 2026-11-07: the document date range ends on 2027-11-07.
setSystemTime(new Date('2026-11-07T10:00:00.000Z'));

const ownJobId = '8f000000-0000-4000-8000-000000000001';
const openInvoiceId = '8f000000-0000-4000-8000-000000000002';
const filedInvoiceId = '8f000000-0000-4000-8000-000000000003';
const trashedInvoiceId = '8f000000-0000-4000-8000-000000000004';
const trashedFiledInvoiceId = '8f000000-0000-4000-8000-000000000005';
const foreignInvoiceId = '8f000000-0000-4000-8000-000000000006';

const invoice = (id: string, organizationId: string, state: { filed?: boolean; trashed?: boolean } = {}) => ({
  id,
  organization_id: organizationId,
  folder_id: null,
  storage_bucket: 'organization-documents',
  storage_path: `${organizationId}/${id}/rechnung.pdf`,
  original_file_name: 'rechnung.pdf',
  display_name: `rechnung-${id.slice(-1)}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 10,
  category: 'invoice',
  current_version_number: 1,
  uploaded_by: CALLER_ID,
  copied_from_document_id: null,
  metadata: {},
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-01T08:00:00Z',
  deleted_at: state.trashed ? '2026-10-02T08:00:00Z' : null,
  deleted_by: state.trashed ? CALLER_ID : null,
  delete_reason: state.trashed ? 'user_deleted' : null,
  document_date: '2026-10-01',
  retention_class: 'ten_years',
  retention_ends_on: '2036-12-31',
  filed_at: state.filed ? '2026-10-01T09:00:00Z' : null,
  filed_by: state.filed ? CALLER_ID : null,
});

const world = installActionWorld({
  documents: [
    invoice(openInvoiceId, ORGANIZATION_A),
    invoice(filedInvoiceId, ORGANIZATION_A, { filed: true }),
    invoice(trashedInvoiceId, ORGANIZATION_A, { trashed: true }),
    invoice(trashedFiledInvoiceId, ORGANIZATION_A, { filed: true, trashed: true }),
    invoice(foreignInvoiceId, ORGANIZATION_B),
  ],
  ordinary_documents: [
    invoice(openInvoiceId, ORGANIZATION_A),
    invoice(filedInvoiceId, ORGANIZATION_A, { filed: true }),
  ],
  document_links: [
    {
      id: '8f000000-0000-4000-8000-0000000000a1',
      organization_id: ORGANIZATION_A,
      document_id: openInvoiceId,
      job_id: ownJobId,
    },
    {
      id: '8f000000-0000-4000-8000-0000000000a2',
      organization_id: ORGANIZATION_A,
      document_id: filedInvoiceId,
      job_id: ownJobId,
    },
  ],
  // The fake joins nothing: a job row carries its assignments, as the access read embeds them.
  jobs: [
    {
      id: ownJobId,
      organization_id: ORGANIZATION_A,
      title: 'Heizung tauschen',
      job_number: 'A-1',
      project_id: null,
      client_id: null,
      job_assignments: [{ id: '8f000000-0000-4000-8000-0000000000b1', user_id: CALLER_ID }],
    },
  ],
  job_assignments: [
    {
      id: '8f000000-0000-4000-8000-0000000000b1',
      organization_id: ORGANIZATION_A,
      job_id: ownJobId,
      user_id: CALLER_ID,
    },
  ],
  personnel_documents: [],
  organization_members: [
    { id: 'member-caller', organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'buero' },
  ],
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Kim',
      last_name: 'Berger',
      email: 'caller@example.test',
      avatar_path: null,
    },
  ],
});
const answerProfileReferences: typeof world.rpc = ({ name, args }) =>
  name === 'list_profile_references'
    ? listProfileReferencesInWorld(world, args)
    : { data: null, error: { code: 'P0001', message: 'unexpected_call' } };
world.rpc = answerProfileReferences;
const unusedStorage = async (): Promise<never> => {
  throw new Error('a refused retention action reached storage');
};
mock.module('@/lib/storage/r2', () => ({
  copyStorageObject: unusedStorage,
  createSignedDownloadUrl: unusedStorage,
  createSignedUploadUrl: unusedStorage,
  discardStorageObjects: unusedStorage,
  promoteUploadedObject: unusedStorage,
  uploadStagingPath: (path: string) => `staging/${path}`,
}));
const { fileDocument, getJobDocuments, permanentlyDeleteDocument, updateDocumentRetention } = await import(
  '@/lib/documents/actions'
);
const { deleteDocument } = await import('@/lib/documents/library-actions');
const { createDocumentVersionUploadTicket } = await import('@/lib/documents/upload-actions');

const retentionChange = (documentId: string) =>
  updateDocumentRetention({ documentId, documentDate: '2026-01-01', retentionClass: null });

// An employee neither files nor reclassifies, not even a document of their own job.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['fileDocument', () => fileDocument(openInvoiceId)],
    ['updateDocumentRetention', () => retentionChange(openInvoiceId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);

// The employee reads the job's documents without class, end or filed state.
const employeeView = await getJobDocuments(ownJobId);
assert.ok(employeeView.success, 'the assigned employee lost the job documents');
assert.equal(employeeView.documents.length, 2);
assert.ok(
  employeeView.documents.every((document) => document.archive === null),
  'an employee received archive data',
);

for (const role of ['buero', 'admin'] as const) {
  signInAs(world, role);
  // A foreign organization's document answers like an unknown id.
  await assertRefused(
    world,
    [
      [`${role} fileDocument foreign`, () => fileDocument(foreignInvoiceId)],
      [`${role} updateDocumentRetention foreign`, () => retentionChange(foreignInvoiceId)],
    ],
    { success: false, error: 'document_not_found' },
    'reads',
  );
  // A document date outside 1900 to one year after today is refused before
  // any read: a paused partial year never starts or ends a period.
  await assertRefused(
    world,
    [
      [
        `${role} updateDocumentRetention year 20`,
        () =>
          updateDocumentRetention({
            documentId: openInvoiceId,
            documentDate: '0020-03-14',
            retentionClass: 'ten_years',
          }),
      ],
      [
        `${role} updateDocumentRetention before 1900`,
        () =>
          updateDocumentRetention({
            documentId: openInvoiceId,
            documentDate: '1899-12-31',
            retentionClass: 'ten_years',
          }),
      ],
      [
        `${role} updateDocumentRetention past next year`,
        () =>
          updateDocumentRetention({
            documentId: openInvoiceId,
            documentDate: '2027-11-08',
            retentionClass: 'ten_years',
          }),
      ],
    ],
    { success: false, error: 'document_date_out_of_range' },
    'none',
  );
  // A filed document keeps its bytes, its terms and its place outside the trash.
  await assertRefused(
    world,
    [
      [`${role} fileDocument filed`, () => fileDocument(filedInvoiceId)],
      [`${role} updateDocumentRetention filed`, () => retentionChange(filedInvoiceId)],
      [`${role} deleteDocument filed`, () => deleteDocument(filedInvoiceId)],
      [
        `${role} createDocumentVersionUploadTicket filed`,
        () =>
          createDocumentVersionUploadTicket({
            documentId: filedInvoiceId,
            fileName: 'rechnung-2.pdf',
            fileSizeBytes: 10,
            mimeType: 'application/pdf',
          }),
      ],
      [`${role} permanentlyDeleteDocument filed`, () => permanentlyDeleteDocument(trashedFiledInvoiceId)],
    ],
    { success: false, error: 'document_filed' },
    'reads',
  );
  // An unfiled document inside its period leaves the trash only by restore.
  await assertRefused(
    world,
    [[`${role} permanentlyDeleteDocument in period`, () => permanentlyDeleteDocument(trashedInvoiceId)]],
    { success: false, error: 'retention_period_running' },
    'reads',
  );

  // Admin and Büro read the archive data, and file through the one function.
  const managerView = await getJobDocuments(ownJobId);
  assert.ok(managerView.success, `${role}: the job documents were refused`);
  const filed = managerView.documents.find((document) => document.id === filedInvoiceId);
  assert.deepEqual(
    filed?.archive,
    {
      documentDate: '2026-10-01',
      retentionClass: 'ten_years',
      retentionEndsOn: '2036-12-31',
      filedAt: '2026-10-01T09:00:00Z',
      filer: {
        userId: CALLER_ID,
        firstName: 'Kim',
        lastName: 'Berger',
        email: 'caller@example.test',
        avatarPath: null,
      },
    },
    `${role}: the archive data changed`,
  );
  world.rpcCalls.length = 0;
  world.rpc = (call) =>
    call.name === 'file_document'
      ? { data: invoice(openInvoiceId, ORGANIZATION_A, { filed: true }), error: null }
      : answerProfileReferences(call);
  const filing = await fileDocument(openInvoiceId);
  assert.ok(filing.success, `${role}: filing was refused`);
  assert.equal(filing.document.archive?.filedAt, '2026-10-01T09:00:00Z');
  assert.deepEqual(
    world.rpcCalls
      .filter((call) => call.name !== 'list_profile_references')
      .map((call) => [call.name, call.args.p_document_id, call.args.p_organization_id]),
    [['file_document', openInvoiceId, ORGANIZATION_A]],
  );
}
