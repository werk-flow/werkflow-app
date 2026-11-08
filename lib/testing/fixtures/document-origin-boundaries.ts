// The real origin action over the in-memory database
// (werk-flow/werkflow-planning#284). Setting the source system and the old
// number of a legacy original stays with Admin and Büro: an employee is
// refused before any write, a foreign organization's document is not found,
// a filed document refuses the change, and an overlong value is refused
// before any read. Each refusal comes before the database function. An
// assigned employee reads the origin on a document they may read.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const ownJobId = '8f100000-0000-4000-8000-000000000001';
const legacyInvoiceId = '8f100000-0000-4000-8000-000000000002';
const filedInvoiceId = '8f100000-0000-4000-8000-000000000003';
const foreignInvoiceId = '8f100000-0000-4000-8000-000000000004';

const invoice = (id: string, organizationId: string, state: { filed?: boolean } = {}) => ({
  id,
  organization_id: organizationId,
  folder_id: null,
  storage_bucket: 'organization-documents',
  storage_path: `${organizationId}/${id}/scan.pdf`,
  original_file_name: 'scan.pdf',
  display_name: `scan-${id.slice(-1)}.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 10,
  category: 'invoice',
  current_version_number: 1,
  uploaded_by: CALLER_ID,
  copied_from_document_id: null,
  metadata: {},
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-01T08:00:00Z',
  deleted_at: null,
  deleted_by: null,
  delete_reason: null,
  document_date: '2019-03-01',
  retention_class: 'ten_years',
  retention_ends_on: '2029-12-31',
  filed_at: state.filed ? '2026-10-01T09:00:00Z' : null,
  filed_by: state.filed ? CALLER_ID : null,
  source_system: 'Sykasoft',
  source_reference: `RE-2019-004${id.slice(-1)}`,
});

const world = installActionWorld({
  documents: [
    invoice(legacyInvoiceId, ORGANIZATION_A),
    invoice(filedInvoiceId, ORGANIZATION_A, { filed: true }),
    invoice(foreignInvoiceId, ORGANIZATION_B),
  ],
  ordinary_documents: [invoice(legacyInvoiceId, ORGANIZATION_A)],
  document_links: [
    {
      id: '8f100000-0000-4000-8000-0000000000a1',
      organization_id: ORGANIZATION_A,
      document_id: legacyInvoiceId,
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
      job_assignments: [{ id: '8f100000-0000-4000-8000-0000000000b1', user_id: CALLER_ID }],
    },
  ],
  job_assignments: [
    {
      id: '8f100000-0000-4000-8000-0000000000b1',
      organization_id: ORGANIZATION_A,
      job_id: ownJobId,
      user_id: CALLER_ID,
    },
  ],
  personnel_documents: [],
  profiles: [
    { id: CALLER_ID, first_name: 'Kim', last_name: 'Berger', email: 'caller@example.test', avatar_path: null },
  ],
});
const { getJobDocuments, updateDocumentOrigin } = await import('@/lib/documents/actions');

const originChange = (documentId: string) =>
  updateDocumentOrigin({ documentId, sourceSystem: 'Sykasoft', sourceReference: 'RE-2019-0099' });

// An employee never sets an origin, not even on a document of their own job,
// and reads it on that document.
signInAs(world, 'employee');
await assertRefused(
  world,
  [['updateDocumentOrigin', () => originChange(legacyInvoiceId)]],
  { success: false, error: 'not_authorized' },
  'reads',
);
const employeeView = await getJobDocuments(ownJobId);
assert.ok(employeeView.success, 'the assigned employee lost the job documents');
assert.deepEqual(
  employeeView.documents.map((document) => document.origin),
  [{ sourceSystem: 'Sykasoft', sourceReference: 'RE-2019-0042' }],
  'the assigned employee did not read the origin of their job document',
);

for (const role of ['buero', 'admin'] as const) {
  signInAs(world, role);
  await assertRefused(
    world,
    [[`${role} updateDocumentOrigin foreign`, () => originChange(foreignInvoiceId)]],
    { success: false, error: 'document_not_found' },
    'reads',
  );
  await assertRefused(
    world,
    [[`${role} updateDocumentOrigin filed`, () => originChange(filedInvoiceId)]],
    { success: false, error: 'document_filed' },
    'reads',
  );
  await assertRefused(
    world,
    [
      [
        `${role} updateDocumentOrigin overlong number`,
        () =>
          updateDocumentOrigin({
            documentId: legacyInvoiceId,
            sourceSystem: 'Sykasoft',
            sourceReference: '9'.repeat(121),
          }),
      ],
    ],
    { success: false, error: 'invalid_input' },
    'none',
  );

  // Admin and Büro write the trimmed origin through the one function, in their organization.
  world.rpcCalls.length = 0;
  world.rpc = ({ name }) =>
    name === 'update_document_origin'
      ? {
          data: { ...invoice(legacyInvoiceId, ORGANIZATION_A), source_reference: 'RE-2019-0099' },
          error: null,
        }
      : { data: null, error: { code: 'P0001', message: 'unexpected_call' } };
  const change = await updateDocumentOrigin({
    documentId: legacyInvoiceId,
    sourceSystem: ' Sykasoft ',
    sourceReference: ' RE-2019-0099 ',
  });
  assert.ok(change.success, `${role}: the origin change was refused`);
  assert.deepEqual(change.document.origin, { sourceSystem: 'Sykasoft', sourceReference: 'RE-2019-0099' });
  assert.deepEqual(
    world.rpcCalls.map((call) => [
      call.name,
      call.args.p_organization_id,
      call.args.p_document_id,
      call.args.p_source_system,
      call.args.p_source_reference,
    ]),
    [['update_document_origin', ORGANIZATION_A, legacyInvoiceId, 'Sykasoft', 'RE-2019-0099']],
  );
}
