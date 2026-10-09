import { expect, mock, test } from 'bun:test';

// The entity-picker reader behind the `'entity-options'` background read:
// it refuses another organization before any read, an employee never reaches
// a manager's kind, and every query it sends is scoped to the caller's
// organization, so a selected id of another organization returns nothing.

const organizationId = '00000000-0000-4000-8000-000000000001';
const foreignOrganizationId = '00000000-0000-4000-8000-000000000002';
const foreignRecordId = '00000000-0000-4000-8000-0000000000ff';

type Call = { table: string; method: string; args: unknown[] };
const pagedJob = {
  id: '00000000-0000-4000-8000-000000000031',
  title: 'Heizung warten',
  description: null,
  job_number: 'AUF-2026-7',
  client_id: null,
  project_id: null,
  status: 'nicht_bearbeitet',
};
const calls: Call[] = [];
const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];

function recordingClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let paged = false;
      for (const method of ['select', 'eq', 'in', 'or', 'neq', 'is', 'order', 'range', 'limit'])
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (method === 'range') paged = true;
          return builder;
        };
      // A page of jobs holds one job; every by-id read of a foreign id returns nothing.
      builder.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
        resolve({ data: paged && table === 'jobs' ? [pagedJob] : [], error: null });
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: { options: [], hasMore: false }, error: null });
    },
  };
}

type Caller = { userId: string; orgId: string; role: 'admin' | 'employee'; isManagerOrAbove: boolean };
let caller: Caller = { userId: 'manager', orgId: organizationId, role: 'admin', isManagerOrAbove: true };
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: recordingClient }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => recordingClient() }));
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({ success: true, context: caller }),
}));

const { readEntityOptions } = await import('./option-server');

test('another organization is refused before any read', async () => {
  calls.length = 0;
  rpcs.length = 0;
  const result = await readEntityOptions({
    organizationId: foreignOrganizationId,
    kind: 'clients',
    selectedIds: [foreignRecordId],
  });
  expect(result).toEqual({ success: false, error: 'organization_changed' });
  expect(calls).toEqual([]);
  expect(rpcs).toEqual([]);
});

test('every kind reads only the caller organization, also for a foreign selected id', async () => {
  const kinds = [
    'clients',
    'jobs',
    'projects',
    'equipment',
    'service-cases',
    'inventory-items',
    'coverages',
  ] as const;
  for (const kind of kinds) {
    calls.length = 0;
    rpcs.length = 0;
    const result = await readEntityOptions({ organizationId, kind, selectedIds: [foreignRecordId] });
    expect(result.success, kind).toBe(true);
    if (result.success) expect(result.selected, kind).toEqual([]);
    for (const table of new Set(calls.map((call) => call.table))) {
      const scoped = calls.some(
        (call) =>
          call.table === table &&
          call.method === 'eq' &&
          call.args[0] === 'organization_id' &&
          call.args[1] === organizationId,
      );
      expect(scoped, `${kind} reads ${table} outside the caller's organization`).toBe(true);
    }
    for (const rpc of rpcs) expect(rpc.args.p_organization_id, kind).toBe(organizationId);
  }
});

test('a job option leads with its number, as the trigger and the field steps name the job', async () => {
  const result = await readEntityOptions({ organizationId, kind: 'jobs', purpose: 'equipment-work' });
  expect(result.success && result.options.map((option) => option.label)).toEqual([
    'AUF-2026-7 · Heizung warten',
  ]);
});

test("an employee cannot reach a manager's kind or purpose, and no read starts", async () => {
  caller = { userId: 'worker', orgId: organizationId, role: 'employee', isManagerOrAbove: false };
  for (const request of [
    { kind: 'projects' },
    { kind: 'equipment' },
    { kind: 'service-cases' },
    { kind: 'inventory-items' },
    { kind: 'coverages' },
    { kind: 'jobs', purpose: 'project-jobs' },
    { kind: 'jobs', purpose: 'equipment-work' },
  ] as const) {
    calls.length = 0;
    rpcs.length = 0;
    const result = await readEntityOptions({ organizationId, ...request });
    expect(result, JSON.stringify(request)).toEqual({ success: false, error: 'not_authorized' });
    expect(calls).toEqual([]);
    expect(rpcs).toEqual([]);
  }
});
