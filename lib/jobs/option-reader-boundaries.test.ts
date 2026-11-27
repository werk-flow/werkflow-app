import { expect, mock, test } from 'bun:test';

// The entity-picker reader behind the `'entity-options'` background read:
// it refuses another organization before any read, an employee never reaches
// a manager's kind, and every query it sends is scoped to the caller's
// organization, so a selected id of another organization returns nothing. A
// time correction's picker marks the jobs of the person it is for; a person
// outside the organization, or anyone but themselves for an employee, is refused.

const organizationId = '00000000-0000-4000-8000-000000000001';
const foreignOrganizationId = '00000000-0000-4000-8000-000000000002';
const foreignRecordId = '00000000-0000-4000-8000-0000000000ff';
const managerId = '00000000-0000-4000-8000-000000000011';
const workerId = '00000000-0000-4000-8000-000000000012';
const colleagueId = '00000000-0000-4000-8000-000000000013';
const foreignPersonId = '00000000-0000-4000-8000-000000000014';

type Call = { table: string; method: string; args: unknown[]; query: number };
const pagedJob = {
  id: '00000000-0000-4000-8000-000000000031',
  title: 'Heizung warten',
  description: null,
  job_number: 'AUF-2026-7',
  client_id: null,
  project_id: null,
  status: 'nicht_bearbeitet',
  job_assignments: [{ user_id: workerId }],
};
const calls: Call[] = [];
let queryCount = 0;
const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];

// The people of both organizations: these tables answer by their `eq` filters,
// so a membership read without the organization filter finds the foreign person.
const seeded: Record<string, Array<Record<string, unknown>>> = {
  organization_members: [
    { organization_id: organizationId, user_id: managerId },
    { organization_id: organizationId, user_id: workerId },
    { organization_id: organizationId, user_id: colleagueId },
    { organization_id: foreignOrganizationId, user_id: foreignPersonId },
  ],
  profiles: [
    { id: workerId, first_name: 'Erika', last_name: 'Muster', email: 'erika@example.test' },
    { id: colleagueId, first_name: 'Jonas', last_name: 'Berg', email: 'jonas@example.test' },
    { id: foreignPersonId, first_name: 'Fremd', last_name: 'Person', email: 'fremd@example.test' },
  ],
};

function recordingClient() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const query = ++queryCount;
      let paged = false;
      let single = false;
      const filters: Array<[string, unknown]> = [];
      for (const method of [
        'select',
        'eq',
        'in',
        'or',
        'neq',
        'is',
        'order',
        'range',
        'limit',
        'maybeSingle',
      ])
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args, query });
          if (method === 'range') paged = true;
          if (method === 'maybeSingle') single = true;
          if (method === 'eq') filters.push([String(args[0]), args[1]]);
          return builder;
        };
      // A page of jobs holds one job; every by-id read of a foreign id returns nothing.
      const rows = () =>
        table in seeded
          ? (seeded[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value))
          : paged && table === 'jobs'
            ? [pagedJob]
            : [];
      builder.then = (resolve: (value: { data: unknown; error: null }) => void) =>
        resolve({ data: single ? (rows()[0] ?? null) : rows(), error: null });
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      return Promise.resolve({ data: { options: [], hasMore: false }, error: null });
    },
  };
}

type Caller = {
  userId: string;
  orgId: string;
  role: 'admin' | 'buero' | 'employee';
  isManagerOrAbove: boolean;
};
let caller: Caller = { userId: managerId, orgId: organizationId, role: 'admin', isManagerOrAbove: true };
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

test("an invoice's work picker offers only the chosen customer's jobs, before the page boundary", async () => {
  calls.length = 0;
  const clientId = '11111111-1111-4111-8111-111111111111';
  await readEntityOptions({ organizationId, kind: 'jobs', purpose: 'invoice-work', clientId });
  const paged = calls.find((call) => call.method === 'range');
  expect(
    calls.some(
      (call) =>
        call.query === paged?.query &&
        call.method === 'eq' &&
        call.args[0] === 'client_id' &&
        call.args[1] === clientId,
    ),
  ).toBe(true);
});

test("a time correction marks the jobs of the person whose time it changes, the caller's by default", async () => {
  const marks = async (subjectUserId?: string) => {
    const result = await readEntityOptions({
      organizationId,
      kind: 'jobs',
      purpose: 'time-correction',
      ...(subjectUserId ? { subjectUserId } : {}),
    });
    return result.success ? result.options.map((option) => option.description) : result;
  };
  caller = { userId: managerId, orgId: organizationId, role: 'admin', isManagerOrAbove: true };
  expect(await marks()).toEqual([undefined]);
  expect(await marks(managerId)).toEqual([undefined]);
  // The office correcting another person's time sees that person's jobs.
  expect(await marks(workerId)).toEqual(['Erika Muster zugewiesen']);
  expect(await marks(colleagueId)).toEqual([undefined]);
  caller = { userId: workerId, orgId: organizationId, role: 'employee', isManagerOrAbove: false };
  expect(await marks()).toEqual(['Dir zugewiesen']);
  expect(await marks(workerId)).toEqual(['Dir zugewiesen']);
  const result = await readEntityOptions({ organizationId, kind: 'jobs', purpose: 'manual-entry' });
  expect(result.success && result.options.map((option) => option.description)).toEqual([undefined]);
});

test("a correction's picker refuses a person of another organization, and an employee's ask for anyone else", async () => {
  const ask = async (subjectUserId: string) => {
    calls.length = 0;
    const result = await readEntityOptions({
      organizationId,
      kind: 'jobs',
      purpose: 'time-correction',
      subjectUserId,
    });
    // A refusal reads no job and no name.
    expect(calls.filter((call) => call.table !== 'organization_members')).toEqual([]);
    return result;
  };
  for (const role of ['admin', 'buero'] as const) {
    caller = { userId: managerId, orgId: organizationId, role, isManagerOrAbove: true };
    expect(await ask(foreignPersonId)).toEqual({ success: false, error: 'not_authorized' });
    expect(await ask(foreignRecordId)).toEqual({ success: false, error: 'not_authorized' });
  }
  caller = { userId: workerId, orgId: organizationId, role: 'employee', isManagerOrAbove: false };
  for (const person of [colleagueId, managerId, foreignPersonId]) {
    expect(await ask(person)).toEqual({ success: false, error: 'not_authorized' });
    expect(calls).toEqual([]);
  }
  // The person narrows a correction's picker only.
  caller = { userId: managerId, orgId: organizationId, role: 'admin', isManagerOrAbove: true };
  expect(
    await readEntityOptions({
      organizationId,
      kind: 'jobs',
      purpose: 'manual-entry',
      subjectUserId: workerId,
    }),
  ).toEqual({ success: false, error: 'invalid_input' });
});

test("a correction's picker for another person keeps the order by title", async () => {
  caller = { userId: managerId, orgId: organizationId, role: 'admin', isManagerOrAbove: true };
  calls.length = 0;
  await readEntityOptions({
    organizationId,
    kind: 'jobs',
    purpose: 'time-correction',
    subjectUserId: workerId,
  });
  const page = calls.find((call) => call.table === 'jobs' && call.method === 'range')?.query;
  expect(
    calls.filter((call) => call.query === page && call.method === 'order').map((call) => call.args[0]),
  ).toEqual(['title', 'id']);
});

test("an employee cannot reach a manager's kind or purpose, and no read starts", async () => {
  caller = { userId: workerId, orgId: organizationId, role: 'employee', isManagerOrAbove: false };
  for (const request of [
    { kind: 'projects' },
    { kind: 'equipment' },
    { kind: 'service-cases' },
    { kind: 'inventory-items' },
    { kind: 'coverages' },
    { kind: 'jobs', purpose: 'project-jobs' },
    { kind: 'jobs', purpose: 'equipment-work' },
    { kind: 'jobs', purpose: 'invoice-work' },
  ] as const) {
    calls.length = 0;
    rpcs.length = 0;
    const result = await readEntityOptions({ organizationId, ...request });
    expect(result, JSON.stringify(request)).toEqual({ success: false, error: 'not_authorized' });
    expect(calls).toEqual([]);
    expect(rpcs).toEqual([]);
  }
});

test('a work picker leaves archived customers out of its pages, a filter and a selection keep them', async () => {
  caller = { userId: managerId, orgId: organizationId, role: 'admin', isManagerOrAbove: true };
  const archiveFilters = async (purpose: 'customer-work' | 'filter') => {
    calls.length = 0;
    await readEntityOptions({ organizationId, kind: 'clients', purpose, selectedIds: [foreignRecordId] });
    const clientCalls = calls.filter((call) => call.table === 'clients');
    const queryWith = (method: string) => clientCalls.find((call) => call.method === method)?.query;
    const dropsArchived = (query: number | undefined) =>
      clientCalls.some(
        (call) =>
          call.query === query &&
          call.method === 'is' &&
          call.args[0] === 'archived_at' &&
          call.args[1] === null,
      );
    // The page query ends in a range; the read of the selected ids filters by id.
    const page = queryWith('range');
    const selected = queryWith('in');
    // Both reads ran: a reader that returned early would otherwise pass as filtering nothing.
    expect(page).toBeDefined();
    expect(selected).toBeDefined();
    expect(page).not.toBe(selected);
    return { page: dropsArchived(page), selected: dropsArchived(selected) };
  };
  expect(await archiveFilters('customer-work')).toEqual({ page: true, selected: false });
  expect(await archiveFilters('filter')).toEqual({ page: false, selected: false });
});
