import { expect, mock, test } from 'bun:test';
import assert from 'node:assert/strict';

import { createInMemoryAdmin, type InMemoryTables } from '@/lib/testing/fixtures/in-memory-admin';

// The real document and attention Server Actions with only identity, the
// database and storage replaced: an argument that fails its boundary schema is
// rejected with `invalid_input` before any read, and valid input, including a
// blank folder id that means "no folder", still reaches the database. The file
// runs itself in a child process because `mock.module` is process-wide.

const ownOrganization = '10000000-0000-4000-8000-000000000001';
const missingId = '20000000-0000-4000-8000-000000000009';
const invalidInput = { success: false, error: 'invalid_input' };

async function runScenario(): Promise<void> {
  const tables: InMemoryTables = { document_folders: [] };
  let reads = 0;
  const admin = createInMemoryAdmin(tables);
  mock.module('server-only', () => ({}));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: ownOrganization }) }) }));
  mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
  mock.module('@/lib/supabase/admin', () => ({
    createSupabaseAdminClient: () => ({
      ...admin,
      from: (table: string) => {
        reads++;
        return admin.from(table);
      },
    }),
  }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: {},
    getAuthenticatedUser: async () => ({ id: 'caller' }),
    getCachedMemberships: async () => [{ orgId: ownOrganization, role: 'admin' }],
    getCachedOrganizationSettings: async () => null,
    getCachedOrganizationCalendar: async () => null,
  }));
  const documents = await import('@/lib/documents/actions');
  const attention = await import('@/lib/attention/actions');

  const rejected: Array<[string, () => Promise<unknown>]> = [
    ['deleteDocument', () => documents.deleteDocument('not-a-uuid')],
    ['getDocumentDetails', () => documents.getDocumentDetails("' or 1=1")],
    ['getJobDocuments', () => documents.getJobDocuments('')],
    ['deleteDocumentFolder', () => documents.deleteDocumentFolder('x')],
    [
      'renameDocumentFolder',
      () => documents.renameDocumentFolder({ folderId: missingId, name: 'a'.repeat(501) }),
    ],
    [
      'updateDocumentCategory',
      () =>
        documents.updateDocumentCategory({
          documentId: missingId,
          category: 'secret' as 'other',
        }),
    ],
    ['getDocumentLibrary', () => documents.getDocumentLibrary({ view: 'everything' as 'all' })],
    [
      'getDocumentVersionSignedUrl',
      () => documents.getDocumentVersionSignedUrl(missingId, { download: 'yes' as unknown as boolean }),
    ],
    [
      'createDocumentUploadTicket',
      () =>
        documents.createDocumentUploadTicket({
          kind: 'job',
          jobId: 'foreign',
          fileName: 'a.pdf',
          fileSizeBytes: 10,
        }),
    ],
    [
      'getProjectDocumentsOverview',
      () => documents.getProjectDocumentsOverview(missingId, [{ id: 'x', jobNumber: null, title: 'A' }]),
    ],
    [
      'markAttentionNotificationRead',
      () =>
        attention.markAttentionNotificationRead({
          sourceType: 'vacation_decision',
          sourceId: 'not-a-uuid',
          stateVersion: 'v1',
        }),
    ],
  ];
  for (const [name, call] of rejected) {
    assert.deepEqual(await call(), invalidInput, name);
  }
  assert.deepEqual(
    await documents.updateDocumentLinks({ documentId: missingId, addJobIds: ['nope'] }),
    invalidInput,
  );
  assert.deepEqual(await documents.linkDocumentsToTarget({ documentIds: ['nope'], jobId: missingId }), {
    ...invalidInput,
    linkedCount: 0,
    failedCount: 0,
  });
  assert.equal(reads, 0, 'a rejected argument must not reach the database');

  // Valid input passes the boundary unchanged.
  assert.deepEqual(await documents.deleteDocument(missingId), {
    success: false,
    error: 'document_not_found',
  });
  const created = await documents.createDocumentFolder({ name: ' Pläne ', parentFolderId: '' });
  assert.equal(created.success, true);
  assert.equal(tables.document_folders?.[0]?.name, 'Pläne');
  assert.equal(tables.document_folders?.[0]?.parent_folder_id, null);
}

if (process.env.DOCUMENT_ACTION_BOUNDARY_SCENARIO === '1') {
  await runScenario();
} else {
  test('document and attention actions reject arguments that fail their boundary schema before any read', async () => {
    const child = Bun.spawn([process.execPath, import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, DOCUMENT_ACTION_BOUNDARY_SCENARIO: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });
}
