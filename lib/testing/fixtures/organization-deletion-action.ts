// The actual organization deletion over the in-memory database and an
// in-memory bucket. Storage is not transactional, so no file goes at once:
// the action lists the organization's files, and delete_organization_with_files
// removes the rows and queues the listed files for the scheduled purge in one
// transaction, so the bytes outlive the backup window
// (werk-flow/werkflow-planning#286). A refusal before or in the database
// queues no file.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const OTHER_OWNER_ID = '30000000-0000-4000-8000-000000000002';

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: CALLER_ID },
    { id: ORGANIZATION_B, name: 'Fremdbetrieb', unique_code: 'GHIJKL', admin_id: OTHER_OWNER_ID },
  ],
  organization_members: [],
});

const ownObjects = [
  `${ORGANIZATION_A}/documents/vertrag.pdf`,
  `${ORGANIZATION_A}/personnel/gesundheitsnachweis.pdf`,
  `${ORGANIZATION_A}/staging/foto.jpg`,
];
const foreignObject = `${ORGANIZATION_B}/documents/fremd.pdf`;
const bucket = new Set<string>();
let failListing = false;
// The database deletes the rows, but the response is lost.
let lostResponse = false;
const steps: string[] = [];

const organizationRemains = (organizationId: string = ORGANIZATION_A): boolean =>
  (world.tables.organizations ?? []).some((row) => row.id === organizationId);

mock.module('@/lib/storage/r2', () => ({
  listStorageObjectPaths: async ({ organizationId, prefix }: { organizationId: string; prefix: string }) => {
    steps.push('list');
    assert.equal(prefix, `${organizationId}/`, 'the listing reaches beyond the organization');
    if (failListing) throw new Error('listing failed');
    return [...bucket].filter((path) => path.startsWith(prefix));
  },
  deleteStorageObjects: async (): Promise<never> => {
    throw new Error('the deletion removed files before the backup window passed');
  },
  discardStorageObjects: async (): Promise<never> => {
    throw new Error('the deletion removed files before the backup window passed');
  },
}));
// The paths queued for the scheduled purge with the deletion.
const queued = new Set<string>();
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'current_org_id' && world.activeOrganizationCookie !== null
        ? { name, value: world.activeOrganizationCookie }
        : undefined,
    set: (name: string, value: string) => {
      if (name === 'current_org_id') world.activeOrganizationCookie = value;
    },
  }),
  headers: async () => ({ get: () => null }),
}));

const scope = { timeTrackedPeople: 0, closedPeriods: 0, retainedDocuments: 0 };
let databaseRefusal: string | null = null;
world.rpc = ({ name, args }) => {
  if (name === 'get_organization_deletion_scope') {
    assert.equal(args.p_organization_id, ORGANIZATION_A);
    const row = {
      members: 1,
      open_invites: 0,
      clients: 2,
      projects: 0,
      jobs: 3,
      employee_records: 1,
      documents: 2,
      retained_documents: scope.retainedDocuments,
      time_tracked_people: scope.timeTrackedPeople,
      closed_periods: scope.closedPeriods,
      payroll_exports: 0,
    };
    return { data: row, error: null };
  }
  if (name === 'delete_organization_with_files') {
    steps.push('rows');
    if (databaseRefusal) return { data: null, error: { code: 'P0001', message: databaseRefusal } };
    world.tables.organizations = (world.tables.organizations ?? []).filter(
      (row) => row.id !== args.p_organization_id,
    );
    const paths = args.p_storage_paths;
    assert.ok(Array.isArray(paths), 'the deletion got no path list');
    for (const path of paths) queued.add(String(path));
    if (lostResponse) return { data: null, error: { code: '', message: 'TypeError: fetch failed' } };
    return { data: null, error: null };
  }
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { deleteOrganization } = await import('@/lib/org/delete-action');

const reset = (): void => {
  bucket.clear();
  for (const path of [...ownObjects, foreignObject]) bucket.add(path);
  queued.clear();
  steps.length = 0;
  world.rpcCalls.length = 0;
  signInAs(world, 'admin');
};
const assertNothingDeleted = (label: string): void => {
  assert.deepEqual([...queued], [], `${label}: files were queued`);
  assert.equal(bucket.size, ownObjects.length + 1, `${label}: files went`);
  assert.ok(organizationRemains(ORGANIZATION_A), `${label}: the organization went`);
  assert.ok(organizationRemains(ORGANIZATION_B), `${label}: the foreign organization went`);
};

// A caller who is not the owner, and a caller without a membership whose
// cookie names a foreign organization, are refused before any file or row.
reset();
world.tables.organizations = (world.tables.organizations ?? []).map((row) =>
  row.id === ORGANIZATION_A ? { ...row, admin_id: OTHER_OWNER_ID } : row,
);
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: false, error: 'not_authorized' });
assert.deepEqual(steps, [], 'a non-owner reached storage or the database');
assertNothingDeleted('non-owner');
world.tables.organizations = (world.tables.organizations ?? []).map((row) =>
  row.id === ORGANIZATION_A ? { ...row, admin_id: CALLER_ID } : row,
);

reset();
signInAs(world, null);
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(await deleteOrganization('Fremdbetrieb'), { success: false, error: 'org_not_found' });
assert.deepEqual(steps, [], 'a foreign organization id reached storage or the database');
assertNothingDeleted('foreign organization');

// A cookie naming a foreign organization never selects it: the caller's own
// organization stays active, so the foreign name does not match it.
reset();
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(await deleteOrganization('Fremdbetrieb'), { success: false, error: 'name_mismatch' });
assert.deepEqual(steps, [], 'a foreign organization cookie reached storage or the database');
assertNothingDeleted('foreign organization cookie');

// Recorded time, a closed period alone, and a document inside its retention
// period alone refuse before any file or row, each with its own reason;
// recorded time comes first when both hold.
for (const [label, retained, error] of [
  ['recorded time', { timeTrackedPeople: 1, closedPeriods: 0, retainedDocuments: 0 }, 'has_time_records'],
  ['a closed period', { timeTrackedPeople: 0, closedPeriods: 1, retainedDocuments: 0 }, 'has_time_records'],
  [
    'a retained document',
    { timeTrackedPeople: 0, closedPeriods: 0, retainedDocuments: 1 },
    'has_retained_documents',
  ],
  ['both reasons', { timeTrackedPeople: 1, closedPeriods: 0, retainedDocuments: 1 }, 'has_time_records'],
] as const) {
  reset();
  Object.assign(scope, retained);
  assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: false, error }, label);
  assert.deepEqual(steps, [], `${label}: a refused deletion reached storage or the database`);
  assertNothingDeleted(label);
}
Object.assign(scope, { timeTrackedPeople: 0, closedPeriods: 0, retainedDocuments: 0 });

// A failed listing refuses before the database, so the owner can try again.
reset();
failListing = true;
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: false, error: 'delete_org_failed' });
assert.deepEqual(steps, ['list'], 'the rows went although the files could not be listed');
assertNothingDeleted('failed listing');
failListing = false;

// The database's refusal under its lock queues no file: time recorded, a
// document filed, a rename, or any other failure since the checks above.
for (const [refusal, error] of [
  ['has_time_records', 'has_time_records'],
  ['has_retained_documents', 'has_retained_documents'],
  ['name_mismatch', 'name_mismatch'],
  ['connection lost', 'delete_org_failed'],
] as const) {
  reset();
  databaseRefusal = refusal;
  assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: false, error }, refusal);
  assert.deepEqual(steps, ['list', 'rows'], `${refusal}: the database refusal did not keep the files`);
  assertNothingDeleted(`database refusal ${refusal}`);
}
databaseRefusal = null;

const restoreOrganization = (): void => {
  world.tables.organizations = [
    { id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: CALLER_ID },
    ...(world.tables.organizations ?? []),
  ];
};

// A lost response after the rows went is a finished deletion: its files are queued and the action says so.
reset();
lostResponse = true;
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: true, nextOrgId: null });
assert.ok(!organizationRemains(), 'the organization remains');
assert.deepEqual([...queued].sort(), [...ownObjects].sort(), 'a lost response left the files unqueued');
lostResponse = false;
restoreOrganization();

// The deletion removes the rows and queues every file of the organization,
// and only those; every file stays in the bucket until the purge.
reset();
assert.deepEqual(await deleteOrganization(' Musterbetrieb '), { success: true, nextOrgId: null });
assert.deepEqual(steps, ['list', 'rows']);
assert.deepEqual([...queued].sort(), [...ownObjects].sort(), 'the deletion queued other files than its own');
assert.equal(
  bucket.size,
  ownObjects.length + 1,
  'the deletion removed files before the backup window passed',
);
assert.ok(!organizationRemains(), 'the organization remains');
assert.deepEqual(
  world.rpcCalls.find((call) => call.name === 'delete_organization_with_files')?.args,
  {
    p_organization_id: ORGANIZATION_A,
    p_actor_id: CALLER_ID,
    p_confirmation_name: 'Musterbetrieb',
    p_storage_paths: ownObjects,
  },
  'delete_organization_with_files got other arguments than the server-resolved ones',
);
