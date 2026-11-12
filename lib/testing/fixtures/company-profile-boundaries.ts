// The actual company-profile actions over the in-memory database
// (werk-flow/werkflow-planning#378). A signed-out caller, an employee and a
// caller who names another organization are refused before any database or
// storage call, the upload ticket included. Admin and Büro write only their
// own organization's profile: the database call carries the resolved
// organization and actor, never the client's, and a signed upload goes to
// the caller's own Briefpapier folder. The database function's own refusals
// are proven by supabase/tests/company_document_profiles.sql.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

import { EMPTY_COMPANY_PROFILE_DETAILS } from '@/lib/company-profile/profile';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const fileId = '37800000-0000-4000-8000-000000000030';
const storageCalls: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  createSignedUploadUrl: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    storageCalls.push(`sign ${organizationId} ${path}`);
    return 'https://storage.example.test/signed';
  },
  promoteUploadedObject: async ({ path }: { path: string }) => {
    storageCalls.push(`promote ${path}`);
    return { exists: true, sizeBytes: 2048, contentType: 'image/png', path: `${path}-copy` };
  },
  readStorageObject: async ({ path }: { path: string }) => {
    storageCalls.push(`read ${path}`);
    return new Uint8Array([1, 2, 3]);
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    storageCalls.push(...paths.map((path) => `discard ${path}`));
  },
}));

const world = installActionWorld({ company_document_profiles: [] });
world.rpc = () => ({ data: 1, error: null });
const actions = await import('@/lib/company-profile/actions');

const save = (organizationId: string) => () =>
  actions.saveCompanyDocumentProfile({
    organizationId,
    expectedVersion: 0,
    details: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
  });
const ticket = (organizationId: string) => () =>
  actions.createCompanyDocumentFileUploadTicket({
    organizationId,
    kind: 'logo',
    mimeType: 'image/png',
    fileSizeBytes: 2048,
  });
const finalize = (organizationId: string) => () =>
  actions.finalizeCompanyDocumentFileUpload({ organizationId, kind: 'logo', fileId });
const remove = (organizationId: string) => () =>
  actions.removeCompanyDocumentFile({ organizationId, kind: 'stationery_first' });
const everyAction = (organizationId: string) =>
  [
    ['saveCompanyDocumentProfile', save(organizationId)],
    ['createCompanyDocumentFileUploadTicket', ticket(organizationId)],
    ['finalizeCompanyDocumentFileUpload', finalize(organizationId)],
    ['removeCompanyDocumentFile', remove(organizationId)],
  ] as const;

world.callerId = null;
await assertRefused(
  world,
  everyAction(ORGANIZATION_A),
  { success: false, error: 'not_authenticated' },
  'none',
);

// A field worker reads and writes no profile field and signs no upload.
signInAs(world, 'employee');
await assertRefused(world, everyAction(ORGANIZATION_A), { success: false, error: 'not_authorized' }, 'none');

// A manager of A who names B is no member there, whatever the cookie says.
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  world.activeOrganizationCookie = ORGANIZATION_B;
  await assertRefused(world, everyAction(ORGANIZATION_B), { success: false, error: 'not_a_member' }, 'none');
}
assert.deepEqual(storageCalls, [], 'a refused caller reached storage');

// Büro of A writes A's profile as itself.
signInAs(world, 'buero');
assert.deepEqual(await save(ORGANIZATION_A)(), { success: true, version: 1 });
assert.equal(world.rpcCalls.at(-1)?.name, 'save_company_document_profile');
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);
assert.equal(world.rpcCalls.at(-1)?.args.p_actor_id, CALLER_ID);

// Margins that leave the content no room never reach the database.
world.rpcCalls.length = 0;
assert.deepEqual(
  await actions.saveCompanyDocumentProfile({
    organizationId: ORGANIZATION_A,
    expectedVersion: 0,
    details: {
      ...EMPTY_COMPANY_PROFILE_DETAILS,
      firstPageMargins: { topMm: 45, rightMm: 80, bottomMm: 25, leftMm: 80 },
    },
  }),
  { success: false, error: 'margins_leave_no_room' },
);
assert.equal(world.rpcCalls.length, 0);

// A ticket signs a key in A's own Briefpapier folder; a file of another type is refused unsigned.
const signed = await ticket(ORGANIZATION_A)();
assert.ok(signed.success);
assert.match(storageCalls.at(-1) ?? '', new RegExp(`^sign ${ORGANIZATION_A} ${ORGANIZATION_A}/briefpapier/`));
const callsBefore = storageCalls.length;
assert.deepEqual(
  await actions.createCompanyDocumentFileUploadTicket({
    organizationId: ORGANIZATION_A,
    kind: 'logo',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
  }),
  { success: false, error: 'file_type_not_allowed' },
);
assert.equal(storageCalls.length, callsBefore);

// A stored copy the renderer cannot embed is discarded and never registered.
world.rpcCalls.length = 0;
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: false, error: 'file_unreadable' });
assert.equal(world.rpcCalls.length, 0);
assert.equal(storageCalls.at(-1), `discard ${ORGANIZATION_A}/briefpapier/${fileId}/logo-copy`);

// A removal names the caller's organization and actor.
assert.deepEqual(await remove(ORGANIZATION_A)(), { success: true });
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'replace_company_document_file',
  args: {
    p_actor_id: CALLER_ID,
    p_organization_id: ORGANIZATION_A,
    p_kind: 'stationery_first',
    p_storage_path: null,
    p_mime_type: null,
  },
});
