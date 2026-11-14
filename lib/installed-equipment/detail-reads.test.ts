import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

// A failed read on the equipment detail must not look like missing data: the
// lookup failure is not "not found", and a failed label, actor, link,
// predecessor-history or plan read fails the detail instead of dropping links,
// history or a plan the replacement must ask about.
const equipmentRow = {
  id: 'equipment-1',
  organization_id: 'org',
  client_id: 'client-1',
  site_id: 'site-1',
  parent_equipment_id: null,
  predecessor_equipment_id: 'equipment-0',
  equipment_number: 'ANL-2026-001',
  name: 'Wärmepumpe',
  category: 'heat_generation',
  state: 'active',
  archived_at: null,
  voided_at: null,
  version: 1,
};
const tableRows: Record<string, unknown[]> = {
  installed_equipment: [
    equipmentRow,
    { id: 'equipment-0', equipment_number: 'ANL-2025-009', name: 'Gaskessel' },
  ],
  installed_equipment_events: [{ id: 'event-1', actor_id: 'user-1', event_type: 'registered' }],
  installed_equipment_event_links: [{ id: 'event-link-1', event_id: 'event-1', job_id: 'job-1' }],
  installed_equipment_work_links: [{ id: 'work-link-1', job_id: 'job-1', project_id: null }],
  installed_equipment_identifiers: [],
  clients: [{ id: 'client-1', name: 'Kunde' }],
  client_sites: [{ id: 'site-1', name: 'Heizraum', street: null, postal_code: null, city: null }],
  profiles: [{ id: 'user-1', first_name: 'Erika', last_name: 'Muster', email: null }],
  jobs: [{ id: 'job-1', job_number: 'AUF-1', title: 'Wartung' }],
};
const rpcRows: Record<string, unknown[]> = {
  list_installed_equipment_predecessor_events: [
    {
      id: 'event-0',
      equipment_id: 'equipment-0',
      actor_id: 'user-1',
      event_type: 'maintenance_plan_left',
      after_snapshot: { subject: { maintenancePlanNumber: 'WPL-2026-004' } },
    },
  ],
  list_installed_equipment_replacement_plans: [
    {
      plan_id: 'plan-1',
      plan_number: 'WPL-2026-003',
      plan_version: 4,
      plan_status: 'active',
      template_name: 'Heizungswartung',
      next_due_date: null,
    },
  ],
};
let failing: string | null = null;
let lookupRow: unknown = equipmentRow;

const admin = {
  rpc: async (name: string) =>
    failing === name
      ? { data: null, error: { code: 'boom', message: 'boom' } }
      : { data: rpcRows[name] ?? [], error: null },
  from: (table: string) => {
    const failure = { code: 'boom', message: 'boom' };
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      or: () => builder,
      in: () => builder,
      order: () => builder,
      range: () => builder,
      maybeSingle: async () =>
        failing === `${table}:lookup` ? { data: null, error: failure } : { data: lookupRow, error: null },
      then: (resolve: (result: { data: unknown[] | null; error: typeof failure | null }) => void) =>
        resolve(
          failing === table ? { data: null, error: failure } : { data: tableRows[table] ?? [], error: null },
        ),
    };
    return builder;
  },
};

mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({
  updateTag: () => undefined,
  revalidatePath: () => undefined,
  cacheTag: () => undefined,
}));
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: { orgId: 'org', userId: 'user', role: 'admin', isManagerOrAbove: true },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));

const { getInstalledEquipmentDetailByNumber } = await import('./actions');
const loggedFailures = spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => loggedFailures.mockRestore());

beforeEach(() => {
  failing = null;
  lookupRow = equipmentRow;
  loggedFailures.mockClear();
});

test('the detail labels its history and work links from complete reads', async () => {
  const result = await getInstalledEquipmentDetailByNumber('anl-2026-001');
  if (!result.success) throw new Error(result.error);
  expect(result.equipment.events.map((event) => event.actorName)).toEqual(['Erika Muster']);
  expect(result.equipment.events[0]?.links.map((link) => link.label)).toEqual(['Auftrag AUF-1']);
  expect(result.equipment.workLinks.map((link) => link.label)).toEqual(['Auftrag AUF-1']);
});

test('the detail carries the Vorgänger history and the running plans a replacement asks about', async () => {
  const result = await getInstalledEquipmentDetailByNumber('ANL-2026-001');
  if (!result.success) throw new Error(result.error);
  expect(
    result.equipment.predecessorHistory.events.map((event) => [event.equipmentNumber, event.subjectLabel]),
  ).toEqual([['ANL-2025-009', 'Wartungsplan WPL-2026-004']]);
  expect(result.equipment.predecessorHistory.nextOffset).toBeNull();
  expect(result.equipment.replacementPlans).toEqual([
    {
      id: 'plan-1',
      planNumber: 'WPL-2026-003',
      version: 4,
      status: 'active',
      templateName: 'Heizungswartung',
      nextDueDate: null,
    },
  ]);
});

test('a failed lookup is a load failure, while a missing row is not found', async () => {
  failing = 'installed_equipment:lookup';
  expect(await getInstalledEquipmentDetailByNumber('ANL-2026-001')).toEqual({
    success: false,
    error: 'installed_equipment_load_failed',
  });
  expect(loggedFailures).toHaveBeenCalled();
  failing = null;
  lookupRow = null;
  expect(await getInstalledEquipmentDetailByNumber('ANL-2026-001')).toEqual({
    success: false,
    error: 'installed_equipment_not_found',
  });
});

test('a failed related read fails the detail and is logged', async () => {
  for (const table of [
    'installed_equipment_events',
    'installed_equipment_event_links',
    'installed_equipment_work_links',
    'profiles',
    'jobs',
    'list_installed_equipment_predecessor_events',
    'list_installed_equipment_replacement_plans',
  ]) {
    failing = table;
    loggedFailures.mockClear();
    expect(await getInstalledEquipmentDetailByNumber('ANL-2026-001')).toEqual({
      success: false,
      error: 'installed_equipment_load_failed',
    });
    expect(loggedFailures).toHaveBeenCalled();
  }
});
