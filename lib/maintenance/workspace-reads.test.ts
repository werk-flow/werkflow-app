import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

// The workspace reads one page of each list from `list_maintenance_workspace_page`
// and hydrates the rows. The option catalog holds active sites only. A plan
// whose site was later deactivated used to vanish from the workspace together
// with its due work; it now stays listed under its site name, and a failed
// site lookup fails the workspace instead of hiding the plan. The totals are
// the database's, not the length of the page.
const PLAN = '00000000-0000-4000-8000-000000000001';
const DUE = '00000000-0000-4000-8000-000000000002';
const REVISION = '00000000-0000-4000-8000-000000000003';
const tableRows: Record<string, unknown[]> = {
  maintenance_plans: [
    {
      id: PLAN,
      plan_number: 'WP-1',
      client_id: 'client-1',
      site_id: 'site-old',
      current_revision_id: REVISION,
      maintenance_coverage_id: null,
      status: 'active',
    },
  ],
  maintenance_due_work: [
    { id: DUE, maintenance_plan_id: PLAN, status: 'open', due_date: '2026-11-01', job_id: null },
  ],
  maintenance_coverages: [],
  maintenance_plan_revisions: [
    { id: REVISION, revision_number: 1, template_version_id: 'version-1', planned_duration_minutes: 90 },
  ],
  maintenance_plan_revision_equipment: [],
  clients: [{ id: 'client-1', name: 'Kunde' }],
  installed_equipment: [],
  work_template_versions: [
    { id: 'version-1', template_id: 'template-1', name: 'Heizung', version_number: 1 },
  ],
  work_templates: [{ id: 'template-1', target_type: 'job', archived_at: null }],
  organization_members: [],
  service_cases: [],
};
const selection = {
  due: { total: 120, hasAny: true, ids: [DUE] },
  plans: { total: 75, hasAny: true, ids: [PLAN] },
  coverages: { total: 0, hasAny: false, ids: [] },
};
let failingSiteLookup = false;
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

const admin = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: selection, error: null };
  },
  from: (table: string) => {
    let byId = false;
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      lte: () => builder,
      order: () => builder,
      range: () => builder,
      in: (column: string) => {
        if (column === 'id') byId = true;
        return builder;
      },
      then: (
        resolve: (result: {
          data: unknown[] | null;
          error: { code: string; message: string } | null;
        }) => void,
      ) => {
        if (table !== 'client_sites') return resolve({ data: tableRows[table] ?? [], error: null });
        // The catalog read lists active sites (none); the lookup reads the deactivated one by id.
        if (!byId) return resolve({ data: [], error: null });
        return resolve(
          failingSiteLookup
            ? { data: null, error: { code: 'boom', message: 'boom' } }
            : { data: [{ id: 'site-old', name: 'Altes Lager' }], error: null },
        );
      },
    };
    return builder;
  },
};

const QUERY = { search: 'wp', duePage: 3, planPage: 2, coveragePage: 1 };

async function loadMaintenanceWorkspace(): Promise<(typeof import('./actions'))['getMaintenanceWorkspace']> {
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({
    updateTag: () => undefined,
    revalidatePath: () => undefined,
    cacheTag: () => undefined,
  }));
  // The visit actions are not under test; stubs keep their module graph out.
  mock.module('@/lib/jobs/creation', () => ({
    JOB_CREATION_REFUSALS: [],
    prepareJobCreation: async () => null,
  }));
  mock.module('@/lib/data/cached', () => ({ CACHE_TAGS: {} }));
  mock.module('@/lib/planning/creation', () => ({ preparePlanningCreation: async () => null }));
  mock.module('@/lib/jobs/auth', () => ({
    authenticateAndAuthorize: async () => ({
      success: true,
      context: { orgId: 'org', userId: 'user', role: 'admin', isManagerOrAbove: true },
    }),
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  return (await import('./actions')).getMaintenanceWorkspace;
}

// The module mocks run in a child process so they cannot leak into the rest
// of the unit suite.
const ISOLATED = process.env.MAINTENANCE_WORKSPACE_READS_ISOLATED === '1';
const loggedFailures = spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => loggedFailures.mockRestore());

beforeEach(() => {
  failingSiteLookup = false;
  rpcCalls.length = 0;
  loggedFailures.mockClear();
});

test.skipIf(!ISOLATED)('a plan on a deactivated site stays listed with its due work', async () => {
  const getMaintenanceWorkspace = await loadMaintenanceWorkspace();
  const result = await getMaintenanceWorkspace(QUERY);
  if (!result.success) throw new Error(result.error);
  expect(result.workspace.plans.map((plan) => [plan.planNumber, plan.siteName])).toEqual([
    ['WP-1', 'Altes Lager'],
  ]);
  expect(result.workspace.dueWork.map((due) => [due.id, due.plannedDurationMinutes])).toEqual([[DUE, 90]]);
});

test.skipIf(!ISOLATED)('the database selects each page and owns the totals', async () => {
  const getMaintenanceWorkspace = await loadMaintenanceWorkspace();
  const result = await getMaintenanceWorkspace(QUERY);
  if (!result.success) throw new Error(result.error);
  expect(rpcCalls).toEqual([
    {
      name: 'list_maintenance_workspace_page',
      args: expect.objectContaining({
        p_organization_id: 'org',
        p_search: 'wp',
        p_due_page: 3,
        p_plan_page: 2,
        p_coverage_page: 1,
        p_page_size: 50,
      }),
    },
  ]);
  expect(result.workspace.totals).toEqual({
    due: { total: 120, hasAny: true },
    plans: { total: 75, hasAny: true },
    coverages: { total: 0, hasAny: false },
  });
  expect(await getMaintenanceWorkspace({ ...QUERY, duePage: 0 })).toEqual({
    success: false,
    error: 'invalid_input',
  });
});

test.skipIf(!ISOLATED)('a failed site lookup fails the workspace and is logged', async () => {
  const getMaintenanceWorkspace = await loadMaintenanceWorkspace();
  failingSiteLookup = true;
  expect(await getMaintenanceWorkspace(QUERY)).toEqual({ success: false, error: 'maintenance_load_failed' });
  expect(loggedFailures).toHaveBeenCalled();
});

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'maintenance workspace reads pass in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, MAINTENANCE_WORKSPACE_READS_ISOLATED: '1' },
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
    expect(stderr).toContain('3 pass');
  },
  30_000,
);
