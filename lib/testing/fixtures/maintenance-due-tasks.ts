// The office's „Fällige Wartungen“ tasks through the real caller resolution,
// the real set reader and the real derivation, over a stand-in of
// read_manager_attention_sets that answers per organization. Admin and Büro of
// organization A get A's open due items that are überfällig or due within 14
// days, earliest first; a foreign cookie still reads only the caller's
// organization; organization B's office sees only B's item; a field worker
// gets no task and reaches no service-role client; an overflowing set fails
// the derivation instead of a shortened list.
import assert from 'node:assert/strict';
import { setSystemTime } from 'bun:test';
import { LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';

// Thu 26.11.2026, 10:00 Berlin.
setSystemTime(new Date('2026-11-26T09:00:00.000Z'));

const overdueId = '87000000-0000-4000-8000-000000000001';
const todayId = '87000000-0000-4000-8000-000000000002';
const lastLeadDayId = '87000000-0000-4000-8000-000000000003';
const beyondLeadId = '87000000-0000-4000-8000-000000000004';
const foreignId = '87000000-0000-4000-8000-000000000005';

type DueRow = {
  id: string;
  due_date: string;
  plan_number: string;
  site_name: string | null;
  equipment_names: string[];
};
const due = (id: string, dueDate: string, overrides: Partial<DueRow> = {}): DueRow => ({
  id,
  due_date: dueDate,
  plan_number: 'WPL-2026-0007',
  site_name: 'Heizzentrale Lindenhof',
  equipment_names: ['Gasbrennwertkessel'],
  ...overrides,
});

const setsByOrganization = new Map<string, DueRow[]>([
  [
    ORGANIZATION_A,
    [
      due(overdueId, '2026-11-02'),
      due(todayId, '2026-11-26', { equipment_names: ['Enthärtungsanlage', 'Speicher'] }),
      due(lastLeadDayId, '2026-12-10', { site_name: null, equipment_names: [] }),
      // A set read on an earlier day may still hold it; the Berlin day of the read decides.
      due(beyondLeadId, '2026-12-11'),
    ],
  ],
  [ORGANIZATION_B, [due(foreignId, '2026-11-20', { plan_number: 'WPL-FREMD' })]],
]);

const world = installActionWorld({});
world.rpc = ({ name, args }) => {
  assert.equal(name, 'read_manager_attention_sets');
  const organizationId = String(args.p_organization_id);
  return {
    data: {
      requests: [],
      access_proposals: [],
      overdue_jobs: [],
      due_maintenance: setsByOrganization.get(organizationId) ?? [],
    },
    error: null,
  };
};

const { resolveActionContext } = await import('@/lib/org/action-context');
const { readManagerAttentionSets } = await import('@/lib/attention/manager-sets');
const { deriveMaintenanceDueTasks } = await import('@/lib/attention/maintenance-due-tasks');

async function derivedForCaller() {
  const auth = await resolveActionContext();
  assert.ok(auth.success, JSON.stringify(auth));
  return deriveMaintenanceDueTasks(auth.context, readManagerAttentionSets(auth.context));
}

async function tasksOfCaller() {
  const derived = await derivedForCaller();
  assert.equal(derived.failed, false);
  return derived.tasks;
}

// The office of organization A: overdue, due today and due on the 14th day, earliest first.
signInAs(world, 'buero');
assert.deepEqual(await tasksOfCaller(), [
  {
    sourceType: 'maintenance_due',
    sourceId: overdueId,
    equipmentLabel: 'Gasbrennwertkessel',
    siteName: 'Heizzentrale Lindenhof',
    dueDate: '2026-11-02',
    overdue: true,
    href: '/service/wartung?q=WPL-2026-0007',
  },
  {
    sourceType: 'maintenance_due',
    sourceId: todayId,
    equipmentLabel: 'Enthärtungsanlage, Speicher',
    siteName: 'Heizzentrale Lindenhof',
    dueDate: '2026-11-26',
    overdue: false,
    href: '/service/wartung?q=WPL-2026-0007',
  },
  {
    sourceType: 'maintenance_due',
    sourceId: lastLeadDayId,
    equipmentLabel: 'Wartungsplan WPL-2026-0007',
    siteName: null,
    dueDate: '2026-12-10',
    overdue: false,
    href: '/service/wartung?q=WPL-2026-0007',
  },
]);

// Admin with a cookie naming a foreign organization still reads only organization A.
world.rpcCalls = [];
signInAs(world, 'admin');
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [overdueId, todayId, lastLeadDayId],
);
assert.deepEqual(
  world.rpcCalls.map((call) => call.args.p_organization_id),
  [ORGANIZATION_A],
  'the set is read for the caller’s own organization only',
);

// The office of organization B sees its own item only.
signInAs(world, 'buero', ORGANIZATION_B);
assert.deepEqual(
  (await tasksOfCaller()).map((task) => task.sourceId),
  [foreignId],
);

// A field worker plans no maintenance: no task, no set read and no service-role client.
signInAs(world, 'employee');
world.rpcCalls = [];
const requestsBefore = world.adminClientRequests;
assert.deepEqual(await tasksOfCaller(), []);
assert.deepEqual(world.rpcCalls, [], 'a field worker reads no office set');
assert.equal(world.adminClientRequests, requestsBefore, 'a field worker reaches no service-role client');

// One row more than the cap is an overflow: the derivation fails instead of showing a shortened list.
setsByOrganization.set(
  ORGANIZATION_A,
  Array.from({ length: LIST_ROW_CAP + 1 }, (_, index) =>
    due(`87000000-0000-4000-8000-${String(100000 + index).padStart(12, '0')}`, '2026-11-20'),
  ),
);
signInAs(world, 'buero');
assert.deepEqual(await derivedForCaller(), { tasks: [], failed: true });
