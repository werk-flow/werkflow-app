// The actual company-profile actions over the in-memory database
// (werk-flow/werkflow-planning#378). A signed-out caller, an employee, a
// suspended or ended manager, a caller who names another organization, and a
// manager of two organizations whose form names the one no longer active are
// refused before any database or storage call, the upload ticket included. Admin and Büro write only their
// own organization's profile: the database call carries the resolved
// organization and actor, never the client's, and a signed upload goes to
// the caller's own Briefpapier folder, under a folder of the caller's own
// (werk-flow/werkflow-planning#420). Another manager who knows the file id
// finds nothing there to finalize. A finalize whose registration may not have
// committed keeps the staged upload, so its retry under the same file id
// registers the same file. The database function's own refusals are proven by
// supabase/tests/company_document_profiles.sql.
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
// A 1×1 PNG the renderer embeds, and the bytes of a file it cannot read.
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);
let storedBytes = new Uint8Array([1, 2, 3]);
// The staged uploads by the key their ticket signed, as the browser's PUT left them.
const staged = new Set<string>();
let copies = 0;
mock.module('@/lib/storage/r2', () => ({
  createSignedUploadUrl: async ({ organizationId, path }: { organizationId: string; path: string }) => {
    storageCalls.push(`sign ${organizationId} ${path}`);
    return 'https://storage.example.test/signed';
  },
  uploadStagingPath: (_organizationId: string, path: string) => `staging:${path}`,
  copyStagedUpload: async ({ path }: { path: string }) => {
    storageCalls.push(`copy ${path}`);
    if (!staged.has(path)) return { exists: false, sizeBytes: null, contentType: null, path: `${path}-none` };
    copies += 1;
    return { exists: true, sizeBytes: 2048, contentType: 'image/png', path: `${path}-copy${copies}` };
  },
  readStorageObject: async ({ path }: { path: string }) => {
    storageCalls.push(`read ${path}`);
    return storedBytes;
  },
  discardStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    for (const path of paths) {
      storageCalls.push(`discard ${path}`);
      staged.delete(path.replace(/^staging:/, ''));
    }
  },
}));

const world = installActionWorld({ company_document_profiles: [], company_document_profile_events: [] });
// The world ignores revalidation; this fixture records it.
const revalidatedPaths: string[] = [];
mock.module('next/cache', () => ({
  updateTag: () => {},
  revalidatePath: (path: string) => revalidatedPaths.push(path),
  revalidateTag: () => {},
  cacheTag: () => {},
  cacheLife: () => {},
  unstable_cache: () => {
    throw new Error('unexpected unstable_cache');
  },
}));
world.rpc = () => ({ data: 1, error: null });
const actions = await import('@/lib/company-profile/actions');

const saveKey = '37800000-0000-4000-8000-000000000040';
const removeKey = '37800000-0000-4000-8000-000000000041';
const save = (organizationId: string) => () =>
  actions.saveCompanyDocumentProfile({
    organizationId,
    expectedVersion: 0,
    details: { ...EMPTY_COMPANY_PROFILE_DETAILS, companyName: 'Haustechnik Sonnenberg GmbH' },
    attemptKey: saveKey,
  });
const ticket = (organizationId: string) => () =>
  actions.createCompanyDocumentFileUploadTicket({
    organizationId,
    kind: 'logo',
    mimeType: 'image/png',
    fileSizeBytes: 2048,
  });
const seenLogo = `${ORGANIZATION_A}/briefpapier/37800000-0000-4000-8000-000000000031/logo`;
const seenStationery = `${ORGANIZATION_A}/briefpapier/37800000-0000-4000-8000-000000000032/stationery_first`;
const seenFollowing = `${ORGANIZATION_A}/briefpapier/37800000-0000-4000-8000-000000000033/stationery_following`;
const finalize = (organizationId: string) => () =>
  actions.finalizeCompanyDocumentFileUpload({
    organizationId,
    kind: 'logo',
    fileId,
    expectedStoragePath: seenLogo,
  });
const remove = (organizationId: string) => () =>
  actions.removeCompanyDocumentFile({
    organizationId,
    kind: 'stationery_first',
    expectedStoragePath: seenStationery,
    expectedFollowingStoragePath: seenFollowing,
    attemptKey: removeKey,
  });
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

// A suspended or ended Admin or Büro member of A is no current member: every
// action refuses before any database or storage call.
for (const role of ['admin', 'buero'] as const) {
  for (const accessState of ['suspended', 'ended'] as const) {
    signInAs(world, role);
    world.memberships = [{ orgId: ORGANIZATION_A, role, accessState }];
    await assertRefused(
      world,
      everyAction(ORGANIZATION_A),
      { success: false, error: 'not_a_member' },
      'none',
    );
  }
}

// A manager of A and B whose form was loaded for A writes nothing once B is
// active: the stale draft never lands in either organization.
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  world.memberships = [
    { orgId: ORGANIZATION_A, role },
    { orgId: ORGANIZATION_B, role },
  ];
  world.activeOrganizationCookie = ORGANIZATION_B;
  await assertRefused(
    world,
    everyAction(ORGANIZATION_A),
    { success: false, error: 'organization_changed' },
    'none',
  );
}
assert.deepEqual(storageCalls, [], 'a refused caller reached storage');

// Büro of A writes A's profile as itself.
signInAs(world, 'buero');
assert.deepEqual(await save(ORGANIZATION_A)(), { success: true, version: 1 });
assert.equal(world.rpcCalls.at(-1)?.name, 'save_company_document_profile');
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);
assert.equal(world.rpcCalls.at(-1)?.args.p_actor_id, CALLER_ID);
assert.equal(world.rpcCalls.at(-1)?.args.p_attempt_key, saveKey);

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
    attemptKey: saveKey,
  }),
  { success: false, error: 'margins_leave_no_room' },
);
assert.equal(world.rpcCalls.length, 0);

// A ticket signs a key in A's own Briefpapier folder, under the caller's own
// folder; a file of another type is refused unsigned.
const signed = await ticket(ORGANIZATION_A)();
assert.ok(signed.success);
assert.equal(
  storageCalls.at(-1),
  `sign ${ORGANIZATION_A} ${ORGANIZATION_A}/briefpapier/${signed.ticket.fileId}/${CALLER_ID}/logo`,
);
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

const ownUpload = `${ORGANIZATION_A}/briefpapier/${fileId}/${CALLER_ID}/logo`;
const ownStaging = `staging:${ownUpload}`;

// A stored copy the renderer cannot embed is discarded with its staged upload and never registered.
staged.add(ownUpload);
world.rpcCalls.length = 0;
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: false, error: 'file_unreadable' });
assert.equal(world.rpcCalls.length, 0);
assert.deepEqual(storageCalls.slice(-2), [`discard ${ownUpload}-copy1`, `discard ${ownStaging}`]);

// Another manager of A who knows the caller's file id finalizes it: the key
// recomputed from that session holds nothing, so no object is copied or
// removed, nothing is written, and the caller's staged logo stays.
const COWORKER_ID = '30000000-0000-4000-8000-000000000002';
storedBytes = PNG_BYTES;
staged.add(ownUpload);
for (const role of ['admin', 'buero'] as const) {
  signInAs(world, role);
  world.callerId = COWORKER_ID;
  const coworkerFrom: number = storageCalls.length;
  world.rpcCalls.length = 0;
  assert.deepEqual(
    await finalize(ORGANIZATION_A)(),
    { success: false, error: 'file_missing' },
    `${role}: another manager finalized the caller's staged logo`,
  );
  assert.deepEqual(
    storageCalls.slice(coworkerFrom),
    [`copy ${ORGANIZATION_A}/briefpapier/${fileId}/${COWORKER_ID}/logo`],
    `${role}: another manager's finalize reached the caller's staged logo`,
  );
  assert.equal(world.rpcCalls.length, 0, `${role}: another manager's finalize wrote`);
  assert.deepEqual([...staged], [ownUpload]);
  assert.deepEqual(world.tables.company_document_profile_events, []);
}

// The caller's own finalize registers the copy with its stored size, for the
// organization export, and then removes the staged upload.
signInAs(world, 'buero');
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: true });
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'replace_company_document_file',
  args: {
    p_actor_id: CALLER_ID,
    p_organization_id: ORGANIZATION_A,
    p_kind: 'logo',
    p_expected_storage_path: seenLogo,
    p_expected_following_storage_path: null,
    p_storage_path: `${ownUpload}-copy2`,
    p_mime_type: 'image/png',
    p_size_bytes: 2048,
    p_attempt_key: fileId,
  },
});
assert.equal(storageCalls.at(-1), `discard ${ownStaging}`);
assert.equal(staged.size, 0);

// A removal names the caller's organization and actor.
assert.deepEqual(await remove(ORGANIZATION_A)(), { success: true });
assert.deepEqual(world.rpcCalls.at(-1), {
  name: 'replace_company_document_file',
  args: {
    p_actor_id: CALLER_ID,
    p_organization_id: ORGANIZATION_A,
    p_kind: 'stationery_first',
    p_expected_storage_path: seenStationery,
    p_expected_following_storage_path: seenFollowing,
    p_storage_path: null,
    p_mime_type: null,
    p_size_bytes: null,
    p_attempt_key: removeKey,
  },
});

// A file someone else changed since the caller saw it: the database refuses
// the removal and the replacement, the caller hears why, and the refused
// upload's copy and staged upload are discarded.
world.rpc = () => ({ data: null, error: { message: 'file_changed', code: 'P0001' } });
assert.deepEqual(await remove(ORGANIZATION_A)(), { success: false, error: 'file_changed' });
staged.add(ownUpload);
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: false, error: 'file_changed' });
assert.deepEqual(storageCalls.slice(-2), [`discard ${ownUpload}-copy3`, `discard ${ownStaging}`]);
assert.equal(staged.size, 0);

// A registration whose answer was lost may still commit, so its copy stays,
// and so does the staged upload: the retry under the same file id copies the
// same upload again and registers it.
staged.add(ownUpload);
world.rpc = () => ({ data: null, error: { message: 'fetch failed' } });
const lostFrom = storageCalls.length;
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: false, error: 'finalize_failed' });
assert.deepEqual(storageCalls.slice(lostFrom), [`copy ${ownUpload}`, `read ${ownUpload}-copy4`]);
assert.ok(staged.has(ownUpload), 'a registration of unknown outcome removed the staged upload');
world.rpc = () => ({ data: null, error: null });
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: true });
assert.equal(world.rpcCalls.at(-1)?.args.p_storage_path, `${ownUpload}-copy5`);
assert.equal(world.rpcCalls.at(-1)?.args.p_attempt_key, fileId);
assert.equal(storageCalls.at(-1), `discard ${ownStaging}`);

// A finalize repeated after its answer was lost: the upload's file id already
// registered a change of this kind by this caller, so it answers as the first
// call did. It copies nothing and writes nothing, and removes the staged
// upload a registration of unknown outcome left.
world.tables.company_document_profile_events = [
  {
    id: '37800000-0000-4000-8000-000000000050',
    organization_id: ORGANIZATION_A,
    field: 'logo',
    actor_id: CALLER_ID,
    attempt_key: fileId,
  },
];
const storageBefore = storageCalls.length;
world.rpcCalls.length = 0;
revalidatedPaths.length = 0;
assert.deepEqual(await finalize(ORGANIZATION_A)(), { success: true });
assert.deepEqual(
  storageCalls.slice(storageBefore),
  [`discard ${ownStaging}`],
  'a repeated finalize copied again or left the staged upload',
);
assert.equal(world.rpcCalls.length, 0, 'a repeated finalize wrote again');
// Its first answer, and the refresh in it, never arrived: this one refreshes the page.
assert.deepEqual(revalidatedPaths, ['/einstellungen/dokumente']);
