// The real link actions over the in-memory database: every added target is
// authorized inside the caller's organization before update_document_links
// writes the links of the document in one transaction
// (supabase/tests/document_writes.sql). A foreign document or target, or a
// field worker, is refused before the database write.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

const ownDocumentId = '95000000-0000-4000-8000-000000000001';
const foreignDocumentId = '95000000-0000-4000-8000-000000000002';
const ownJobId = '96000000-0000-4000-8000-000000000001';
const foreignJobId = '96000000-0000-4000-8000-000000000002';
const linkId = '97000000-0000-4000-8000-000000000001';

const documentRow = (id: string, organizationId: string) => ({
  id,
  organization_id: organizationId,
  folder_id: null,
  storage_path: `${organizationId}/${id}/plan.pdf`,
  display_name: 'plan.pdf',
  category: 'other',
  deleted_at: null,
});

const world = installActionWorld({
  documents: [documentRow(ownDocumentId, ORGANIZATION_A), documentRow(foreignDocumentId, ORGANIZATION_B)],
  personnel_documents: [],
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A },
    { id: foreignJobId, organization_id: ORGANIZATION_B },
  ],
  document_links: [
    { id: linkId, organization_id: ORGANIZATION_A, document_id: ownDocumentId, job_id: ownJobId },
  ],
});
world.rpc = ({ name, args }) =>
  name === 'update_document_links'
    ? {
        data: [
          {
            added_count: Array.isArray(args.p_add_job_ids) ? args.p_add_job_ids.length : 0,
            removed_count: Array.isArray(args.p_remove_link_ids) ? args.p_remove_link_ids.length : 0,
          },
        ],
        error: null,
      }
    : { data: null, error: { message: `${name} is outside this fixture` } };

const { linkDocumentsToTarget, unlinkDocument, updateDocumentLinks } = await import(
  '@/lib/documents/actions'
);

// A manager cannot add another organization's job, nor change another organization's document.
signInAs(world, 'buero');
assert.deepEqual(
  await updateDocumentLinks({ documentId: ownDocumentId, addJobIds: [ownJobId, foreignJobId] }),
  {
    success: false,
    error: 'job_not_found',
  },
);
assert.deepEqual(await updateDocumentLinks({ documentId: foreignDocumentId, addJobIds: [ownJobId] }), {
  success: false,
  error: 'document_not_found',
});
assert.deepEqual(await linkDocumentsToTarget({ documentIds: [foreignDocumentId], jobId: ownJobId }), {
  success: false,
  error: 'link_failed',
  linkedCount: 0,
  failedCount: 1,
});
assert.equal(world.rpcCalls.length, 0);

// A field worker changes no link.
signInAs(world, 'employee');
assert.deepEqual(await updateDocumentLinks({ documentId: ownDocumentId, addJobIds: [ownJobId] }), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(await unlinkDocument({ linkId }), { success: false, error: 'not_authorized' });
assert.equal(world.rpcCalls.length, 0);

// The manager's change reaches the one function call, scoped to the organization.
signInAs(world, 'buero');
assert.deepEqual(
  await updateDocumentLinks({ documentId: ownDocumentId, addJobIds: [ownJobId], removeLinkIds: [linkId] }),
  { success: true, addedCount: 1, removedCount: 1 },
);
assert.deepEqual(await unlinkDocument({ linkId }), { success: true });
assert.deepEqual(
  world.rpcCalls.map(({ name, args }) => [name, args.p_organization_id, args.p_document_id]),
  [
    ['update_document_links', ORGANIZATION_A, ownDocumentId],
    ['update_document_links', ORGANIZATION_A, ownDocumentId],
  ],
);
