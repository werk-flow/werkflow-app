// The actual organization deletion over the in-memory database and an
// in-memory bucket: recorded time or a closed period refuses before any file
// or row goes, a failed file deletion leaves the organization in place, and a
// deletion removes every stored file of the organization, and only those,
// before delete_organization removes the rows.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: 'Musterbetrieb', unique_code: 'ABCDEF', admin_id: CALLER_ID },
    { id: ORGANIZATION_B, name: 'Fremdbetrieb', unique_code: 'GHIJKL', admin_id: CALLER_ID },
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
let failFileDeletion = false;
const steps: string[] = [];

mock.module('@/lib/storage/r2', () => ({
  listStorageObjectPaths: async ({ organizationId, prefix }: { organizationId: string; prefix: string }) => {
    assert.equal(prefix, `${organizationId}/`, 'the listing reaches beyond the organization');
    return [...bucket].filter((path) => path.startsWith(prefix));
  },
  deleteStorageObjects: async ({ paths }: { paths: readonly string[] }) => {
    steps.push('files');
    if (failFileDeletion) throw new Error('Failed to delete 1 object(s)');
    for (const path of paths) bucket.delete(path);
  },
}));
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

const scope = { timeTrackedPeople: 0, closedPeriods: 0 };
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
      time_tracked_people: scope.timeTrackedPeople,
      closed_periods: scope.closedPeriods,
      payroll_exports: 0,
    };
    return { data: row, error: null };
  }
  if (name === 'delete_organization') {
    steps.push('rows');
    if (databaseRefusal) return { data: null, error: { code: 'P0001', message: databaseRefusal } };
    world.tables.organizations = (world.tables.organizations ?? []).filter(
      (row) => row.id !== args.p_organization_id,
    );
    return { data: null, error: null };
  }
  return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
};

const { deleteOrganization } = await import('@/lib/org/delete-action');

const organizationRemains = (): boolean =>
  (world.tables.organizations ?? []).some((row) => row.id === ORGANIZATION_A);
const reset = (): void => {
  for (const path of [...ownObjects, foreignObject]) bucket.add(path);
  steps.length = 0;
  world.rpcCalls.length = 0;
  signInAs(world, 'admin');
};

// Recorded time, and a closed period alone, refuse before any file goes.
for (const [label, retained] of [
  ['recorded time', { timeTrackedPeople: 1, closedPeriods: 0 }],
  ['a closed period', { timeTrackedPeople: 0, closedPeriods: 1 }],
] as const) {
  reset();
  Object.assign(scope, retained);
  assert.deepEqual(
    await deleteOrganization('Musterbetrieb'),
    { success: false, error: 'has_time_records' },
    label,
  );
  assert.deepEqual(steps, [], `${label}: a refused deletion removed files or rows`);
  assert.equal(bucket.size, ownObjects.length + 1, `${label}: a refused deletion removed files`);
  assert.ok(organizationRemains(), `${label}: a refused deletion removed the organization`);
}
Object.assign(scope, { timeTrackedPeople: 0, closedPeriods: 0 });

// A failed file deletion is visible and leaves the organization for a retry.
reset();
failFileDeletion = true;
assert.deepEqual(await deleteOrganization('Musterbetrieb'), { success: false, error: 'files_delete_failed' });
assert.deepEqual(steps, ['files'], 'the rows went although the files did not');
assert.ok(organizationRemains(), 'a failed file deletion removed the organization');
failFileDeletion = false;

// The database's own refusal under its lock, after the files went, says so.
reset();
databaseRefusal = 'has_time_records';
assert.deepEqual(await deleteOrganization('Musterbetrieb'), {
  success: false,
  error: 'time_recorded_during_deletion',
});
assert.ok(organizationRemains(), 'a database refusal removed the organization');
databaseRefusal = null;

// The deletion removes every file of the organization first, then its rows.
reset();
assert.deepEqual(await deleteOrganization(' Musterbetrieb '), { success: true, nextOrgId: null });
assert.deepEqual(steps, ['files', 'rows']);
assert.deepEqual([...bucket], [foreignObject], 'the deletion left own files or removed foreign ones');
assert.ok(!organizationRemains(), 'the organization remains');
assert.deepEqual(
  world.rpcCalls.find((call) => call.name === 'delete_organization')?.args,
  { p_organization_id: ORGANIZATION_A, p_actor_id: CALLER_ID, p_confirmation_name: 'Musterbetrieb' },
  'delete_organization got other arguments than the server-resolved ones',
);
