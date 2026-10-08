import { describe, expect, mock, test } from 'bun:test';

// Tier 2 for "attention count reads" (docs/technical/realtime-and-caching.md):
// the badge counts run on every debounced Realtime event and every catch-up of
// every signed-in session, so the number of queries one derivation sends is a
// budget. This test drives the real derivation through the real GET read
// scope against a counting fake client and pins the queries per role. A new
// query, or a shared read that is no longer shared, fails here with
// the table list that changed.

const ORG = '6b0c3f8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f';
const USER = '7c1d4a9f-2e3b-4d6c-8f0a-1b2c3d4e5f60';
const OWN_RECORD = '8d2e5b0a-3f4c-4e7d-9a1b-2c3d4e5f6071';

type Role = 'admin' | 'buero' | 'employee';
type QueryResult = { data: unknown; error: { code: string } | null; count: number };

let role: Role = 'admin';
let failingTable: string | null = null;
let queries: string[] = [];

// The steady state of a typical member: an own employee record, no pending
// work. Every derivation then stops after its first scarce read.
function rowsOf(table: string): Record<string, unknown>[] {
  if (table === 'organization_members') {
    return [
      {
        organization_id: ORG,
        role,
        joined_at: '2026-01-01T00:00:00Z',
        user_id: USER,
        organizations: { id: ORG, name: 'Organisation', unique_code: 'ORG', employee_records: [] },
      },
    ];
  }
  if (table === 'employee_records') {
    return [{ id: OWN_RECORD, user_id: USER, first_name: 'Erika', last_name: 'Muster', exit_date: null }];
  }
  return [];
}

const BUILDER_METHODS = [
  'select',
  'eq',
  'neq',
  'in',
  'is',
  'gt',
  'gte',
  'lt',
  'lte',
  'or',
  'not',
  'order',
  'range',
  'limit',
  'filter',
] as const;

function countingQuery(table: string) {
  let single = false;
  const builder: Record<string, unknown> = {};
  for (const method of BUILDER_METHODS) builder[method] = () => builder;
  builder.maybeSingle = () => {
    single = true;
    return builder;
  };
  builder.single = builder.maybeSingle;
  builder.then = (resolve: (result: QueryResult) => unknown) => {
    queries.push(single ? `${table} (one row)` : table);
    if (table === failingTable)
      return Promise.resolve(resolve({ data: null, error: { code: '57014' }, count: 0 }));
    const rows = rowsOf(table);
    return Promise.resolve(
      resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length }),
    );
  };
  return builder;
}

const client = {
  from: (table: string) => countingQuery(table),
  rpc: (name: string) => countingQuery(`rpc ${name}`),
  auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
};

// Module mocks are process-wide and a later mock cannot add exports to an
// earlier one, so the mocked scenario runs in its own process.
const ISOLATED = process.env.ATTENTION_COUNT_READS_ISOLATED === '1';

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'the attention count read cases pass in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, ATTENTION_COUNT_READS_ISOLATED: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(
      status,
      `${stdout}
${stderr}`,
    ).toBe(0);
    expect(stderr).toContain('4 pass');
  },
  30_000,
);

if (ISOLATED) {
  mock.module('server-only', () => ({}));
  mock.module('@/lib/logging', () => ({ logError: () => undefined }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => client }));
  mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => client }));
  mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: ORG }) }) }));

  const { getAttentionCounts, getAttentionOverview } = await import('./actions');
  const { withReadRequest } = await import('@/lib/data/read-request-cache');

  async function readAs<Result>(nextRole: Role, read: () => Promise<Result>) {
    role = nextRole;
    queries = [];
    // The same scope the GET handlers open (app/api/attention-counts, app/api/background-read).
    const result = await withReadRequest(new Request('http://localhost/api/attention-counts'), read, {
      priority: 'background',
    });
    return { result, queries: [...queries].sort() };
  }

  // One derivation in the steady state, sorted. Shared membership,
  // responsibility and own-record reads appear once per request.
  const MANAGER_COUNT_QUERIES = [
    'client_follow_ups',
    'client_requests',
    'employee_capabilities',
    'employee_records',
    'employee_records (one row)',
    'jobs',
    'jobs',
    'organization_join_requests',
    'organization_members',
    'organization_members',
    'organization_members',
    'organization_responsibility_assignments',
    'organization_responsibility_configurations',
    'organization_responsibility_delegations',
    'planning_dispatch_acknowledgements',
    'planning_dispatch_recipients',
    'profiles',
    'projects',
    'sickness_reports',
    'time_correction_requests',
    'time_entries',
    'vacation_requests',
    'vacation_requests',
    'work_artifact_defect_details',
    'work_artifacts',
    'work_blockers',
  ];
  const EMPLOYEE_COUNT_QUERIES = [
    'employee_records',
    'employee_records (one row)',
    'organization_members',
    'organization_members',
    'organization_responsibility_assignments',
    'organization_responsibility_configurations',
    'organization_responsibility_delegations',
    'planning_dispatch_recipients',
    'profiles',
    'sickness_reports',
    'time_correction_requests',
    'vacation_requests',
    'vacation_requests',
    'work_artifact_defect_details',
    'work_artifacts',
  ];

  describe('attention count reads', () => {
    test('one count derivation sends a fixed set of queries per role', async () => {
      const admin = await readAs('admin', getAttentionCounts);
      expect(admin.result.success).toBe(true);
      // Only the admin keeps the change-request recovery queue.
      expect(admin.queries).toEqual([...MANAGER_COUNT_QUERIES, 'entry_change_requests'].sort());

      const buero = await readAs('buero', getAttentionCounts);
      expect(buero.queries).toEqual(MANAGER_COUNT_QUERIES);

      const employee = await readAs('employee', getAttentionCounts);
      expect(employee.queries).toEqual(EMPLOYEE_COUNT_QUERIES);
    });

    test('the dispatch, decision and sickness derivations share one read of the own employee record', async () => {
      const { queries: sent } = await readAs('buero', getAttentionCounts);
      expect(
        sent.filter((query) => query === 'employee_records (one row)'),
        'Start readOwnEmployeeRecord once per derivation in lib/attention/actions.ts and pass the promise on.',
      ).toHaveLength(1);
    });

    test('the overview runs the same derivation plus the own vacation overview, never a second one', async () => {
      const counts = await readAs('employee', getAttentionCounts);
      const overview = await readAs('employee', getAttentionOverview);
      const extra = [...overview.queries];
      for (const query of counts.queries) {
        const index = extra.indexOf(query);
        expect(index, `the overview no longer sends the count query ${query}`).toBeGreaterThanOrEqual(0);
        extra.splice(index, 1);
      }
      // What remains is getOwnVacationOverview (lib/vacation/actions.ts). It
      // fails in this world without employment conditions, which fails the
      // overview visibly; the derivation beside it still ran exactly once.
      expect(overview.result).toEqual({ success: false, error: 'load_failed' });
      expect(extra).toEqual([
        'employee_records (one row)',
        'employment_conditions',
        'vacation_requests',
        'work_schedules',
      ]);
    });

    test('a failed read fails the counts instead of reporting zero', async () => {
      failingTable = 'sickness_reports';
      try {
        const { result } = await readAs('admin', getAttentionCounts);
        expect(result).toEqual({ success: false, error: 'load_failed' });
      } finally {
        failingTable = null;
      }
    });
  });
}
