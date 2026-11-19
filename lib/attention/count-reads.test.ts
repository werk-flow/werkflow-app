import { describe, expect, mock, setSystemTime, test } from 'bun:test';

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
// The open jobs past their visits that the office's set read returns, and the organizations it was asked for.
let overdueJobs: Record<string, unknown>[] = [];
let openRequests: Record<string, unknown>[] = [];
let managerSetOrganizations: unknown[] = [];
// Extra rows a case seeds, by table; the viewer's own one-row record read can come back empty.
let seededRows: Record<string, Record<string, unknown>[]> = {};
let withOwnRecord = true;

// The steady state of a typical member: an own employee record, no pending
// work. Every derivation then stops after its first scarce read.
function rowsOf(table: string): Record<string, unknown>[] {
  const seeded = seededRows[table];
  if (seeded) return seeded;
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
    return [
      {
        id: OWN_RECORD,
        user_id: USER,
        first_name: 'Erika',
        last_name: 'Muster',
        exit_date: null,
        personnel_access_lifecycles: [],
        personnel_onboarding_requirements: [],
      },
    ];
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
    // The read functions that answer an object: the open absences, here none.
    if (table === 'rpc read_open_absences')
      return Promise.resolve(resolve({ data: { vacations: [], leaverWindows: [] }, error: null, count: 0 }));
    // The other one: the open requests, access proposals and overdue jobs of the office, here none.
    if (table === 'rpc read_manager_attention_sets')
      return Promise.resolve(
        resolve({
          data: { requests: openRequests, access_proposals: [], overdue_jobs: overdueJobs },
          error: null,
          count: 0,
        }),
      );
    // The viewer's own record is the one-row read; the responsibility holders read the list.
    const rows = single && table === 'employee_records' && !withOwnRecord ? [] : rowsOf(table);
    return Promise.resolve(
      resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length }),
    );
  };
  return builder;
}

const client = {
  from: (table: string) => countingQuery(table),
  rpc: (name: string, args: Record<string, unknown>) => {
    if (name === 'read_manager_attention_sets') managerSetOrganizations.push(args.p_organization_id);
    return countingQuery(`rpc ${name}`);
  },
  auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
};

// Module mocks are process-wide and a later mock cannot add exports to an
// earlier one, so the mocked scenario runs in its own process.
const ISOLATED = process.env.ATTENTION_COUNT_READS_ISOLATED === '1';

test.skipIf(ISOLATED)('the attention count read cases pass in an isolated process', async () => {
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
  expect(stderr).toContain('8 pass');
});

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
    'employee_capabilities',
    'employee_records',
    'employee_records (one row)',
    'jobs',
    'organization_join_requests',
    'organization_members',
    'organization_members',
    'organization_members',
    'organization_responsibility_assignments',
    'organization_responsibility_configurations',
    'organization_responsibility_delegations',
    'planning_dispatch_acknowledgements',
    'profiles',
    'projects',
    'rpc list_handover_candidate_projects',
    'rpc list_pending_dispatch_recipients',
    'rpc read_manager_attention_sets',
    'rpc read_open_absences',
    'sickness_reports',
    'time_correction_requests',
    'time_entries',
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
    'profiles',
    'rpc list_pending_dispatch_recipients',
    'rpc read_open_absences',
    'sickness_reports',
    'time_correction_requests',
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

    test("an open job past its last visit is a task of the session organization's Admin and Büro, never of an employee", async () => {
      overdueJobs = [
        {
          id: '9e3f5a71-4b2c-4d8e-a1f0-6c7b8d9e0f12',
          job_number: 'A-1001',
          title: 'Heizung warten',
          project_id: null,
          project_number: null,
          created_at: '2025-01-02T08:00:00Z',
          last_timed_end: '2025-01-10T15:00:00Z',
          last_all_day_end: null,
        },
      ];
      managerSetOrganizations = [];
      try {
        const buero = await readAs('buero', getAttentionCounts);
        expect(buero.result).toMatchObject({ success: true, counts: { actionableCount: 1 } });
        const employee = await readAs('employee', getAttentionCounts);
        expect(employee.result).toMatchObject({ success: true, counts: { actionableCount: 0 } });
        // Only the office viewer's derivation read the set, and only for its own organization.
        expect(managerSetOrganizations).toEqual([ORG]);
      } finally {
        overdueJobs = [];
      }
    });

    test("another manager's overdue callback reaches Admin once it is overdue more than two workdays, never Büro or an employee", async () => {
      const OTHER_MANAGER = '9f3e6c1b-4a5d-4e8f-a0b1-c2d3e4f5a6b7';
      const request = (id: string, callbackDueAt: string) => ({
        id,
        request_number: null,
        summary: 'Heizung fällt aus',
        status: 'offen',
        urgency: 'normal',
        assigned_to: OTHER_MANAGER,
        received_at: '2025-01-02T08:00:00Z',
        callback_due_at: callbackDueAt,
        callback_overdue: true,
        owner_is_manager: true,
      });
      // Thursday, 19 November 2026: due last Thursday is five workdays overdue, due yesterday one.
      setSystemTime(new Date('2026-11-19T10:00:00Z'));
      const LONG_OVERDUE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
      const JUST_OVERDUE = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
      openRequests = [
        request(LONG_OVERDUE, '2026-11-12T09:00:00Z'),
        request(JUST_OVERDUE, '2026-11-18T09:00:00Z'),
      ];
      seededRows = {
        profiles: [{ id: OTHER_MANAGER, first_name: 'Erika', last_name: 'Musterfrau', email: null }],
      };
      // Without an own record the own vacation overview succeeds, so the overview shows its tasks.
      withOwnRecord = false;
      managerSetOrganizations = [];
      const kinds = async (viewer: Role) => {
        const { result } = await readAs(viewer, getAttentionOverview);
        if (!result.success) throw new Error(`overview failed for ${viewer}`);
        return result.overview.tasks.map((task) => [task.sourceId, task.sourceType, task]);
      };
      try {
        const admin = await kinds('admin');
        expect(admin.map(([id, kind]) => [id, kind])).toEqual([
          [LONG_OVERDUE, 'client_request_callback_overdue'],
          [JUST_OVERDUE, 'client_request_open'],
        ]);
        expect(admin[0]?.[2]).toMatchObject({ ownerName: 'Erika Musterfrau', assignedToMe: false });
        const buero = await kinds('buero');
        expect(buero.map(([id, kind]) => [id, kind])).toEqual([
          [LONG_OVERDUE, 'client_request_open'],
          [JUST_OVERDUE, 'client_request_open'],
        ]);
        expect(await kinds('employee')).toEqual([]);
        // Only the managers' derivations read the set, each for the session's organization.
        expect(managerSetOrganizations).toEqual([ORG, ORG]);
      } finally {
        setSystemTime();
        openRequests = [];
        seededRows = {};
        withOwnRecord = true;
      }
    });

    test('a project completed by hand waits since its recorded completion, whatever later edit or withdrawn release moved it', async () => {
      const PROJECT = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
      setSystemTime(new Date('2026-11-19T10:00:00Z'));
      seededRows = {
        projects: [
          {
            id: PROJECT,
            project_number: 'P-2026-001',
            name: 'Bad sanieren',
            execution_version: 2,
            execution_state_override: 'execution_complete',
            status_override: 'abgeschlossen',
            // Edited after the completion.
            updated_at: '2026-11-18T09:00:00Z',
            // Its transitions to execution_complete, embedded in the same read.
            work_execution_events: [
              { event_type: 'reopened', created_at: '2026-11-12T09:00:00Z' },
              // Released and withdrawn again: the work stayed complete since the 12th.
              { event_type: 'handover_withdrawn', created_at: '2026-11-18T08:00:00Z' },
            ],
          },
        ],
      };
      withOwnRecord = false;
      try {
        const { result } = await readAs('admin', getAttentionOverview);
        if (!result.success) throw new Error('overview failed');
        expect(result.overview.tasks).toEqual([
          expect.objectContaining({
            sourceType: 'work_handover_review',
            sourceId: PROJECT,
            completedOn: '2026-11-12',
          }),
        ]);
      } finally {
        setSystemTime();
        seededRows = {};
        withOwnRecord = true;
      }
    });

    test('a project completed through its child jobs has no completion day while a finished child carries none', async () => {
      const PROJECT = '4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a';
      const child = (id: string, actualCompletionDate: string | null) => ({
        id,
        job_number: null,
        title: 'Heizung tauschen',
        execution_version: 1,
        project_id: PROJECT,
        execution_state: null,
        status: 'fertig',
        updated_at: '2026-11-02T09:00:00Z',
        actual_completion_date: actualCompletionDate,
      });
      setSystemTime(new Date('2026-11-19T10:00:00Z'));
      seededRows = {
        'rpc list_handover_candidate_projects': [{ project_id: PROJECT }],
        projects: [
          {
            id: PROJECT,
            project_number: 'P-2026-002',
            name: 'Heizungsanlage erneuern',
            execution_version: 1,
            execution_state_override: null,
            status_override: null,
            updated_at: '2026-10-01T09:00:00Z',
            work_execution_events: [],
          },
        ],
        // One child completed on the 10th, one finished before completion dates were recorded.
        jobs: [
          child('5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', '2026-11-10'),
          child('6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c', null),
        ],
      };
      withOwnRecord = false;
      try {
        const { result } = await readAs('admin', getAttentionOverview);
        if (!result.success) throw new Error('overview failed');
        expect(result.overview.tasks.find((task) => task.sourceId === PROJECT)).toMatchObject({
          sourceType: 'work_handover_review',
          completedOn: null,
        });
      } finally {
        setSystemTime();
        seededRows = {};
        withOwnRecord = true;
      }
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
