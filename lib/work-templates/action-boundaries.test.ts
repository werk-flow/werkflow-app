import { beforeEach, expect, mock, test } from 'bun:test';

// applyWorkTemplate reads the assignments of a job id the client sent before
// any server check has tied that job to the caller's organization. The read
// runs on the service-role client, so only its own organization filter keeps
// another tenant's assignments out. The other cases pin that a malformed
// argument is refused before authentication or any database call.

const ORGANIZATION_ID = '0a000000-0000-0000-0000-000000000001';
const JOB_ID = '0b000000-0000-0000-0000-000000000002';
const VERSION_ID = '0c000000-0000-0000-0000-000000000003';
const TEMPLATE_ID = '0d000000-0000-0000-0000-000000000004';

type Filter = { table: string; column: string; value: unknown };
let filters: Filter[];
let rpcCalls: string[];
let authCalls: number;
let appliedInputs: unknown[];

const admin = {
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push({ table, column, value });
        return query;
      },
      limit: async () => ({ data: [], error: null }),
    };
    return query;
  },
  rpc: async (name: string) => {
    rpcCalls.push(name);
    return { data: null, error: null };
  },
};

// Module mocks are process-wide, so the mocked scenario runs in its own process.
const ISOLATED = process.env.WORK_TEMPLATE_ACTION_BOUNDARIES_ISOLATED === '1';

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'the work-template boundary cases pass in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, WORK_TEMPLATE_ACTION_BOUNDARIES_ISOLATED: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(status, `${stdout}\n${stderr}`).toBe(0);
    expect(stderr).toContain('4 pass');
  },
  30_000,
);

if (ISOLATED) {
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({ revalidatePath: () => undefined, updateTag: () => undefined }));
  mock.module('@/lib/data/cached', () => ({
    CACHE_TAGS: { workTemplates: (organizationId: string) => `work-templates-${organizationId}` },
  }));
  mock.module('@/lib/data/read-request-cache', () => ({ logReadFailure: () => undefined }));
  mock.module('@/lib/jobs/auth', () => ({
    authenticateAndAuthorize: async () => {
      authCalls += 1;
      return {
        success: true,
        context: { orgId: ORGANIZATION_ID, userId: 'user', isManagerOrAbove: true },
      };
    },
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  mock.module('@/lib/qualifications/server', () => ({
    loadAssignmentEvaluation: async () => ({
      success: true,
      evaluation: { requiresOverride: false, fingerprint: 'fingerprint' },
    }),
  }));
  mock.module('./server', () => ({
    applyWorkTemplateWithAdmin: async (
      _admin: unknown,
      _organizationId: string,
      _actorId: string,
      input: unknown,
    ) => {
      appliedInputs.push(input);
      return { data: { applied: true }, error: null };
    },
    findUnavailableWorkTemplateReference: async () => null,
    loadPublishedWorkTemplateOptions: async () => [],
    loadWorkTemplateApplicationPreview: async () => null,
    loadWorkTemplateDetail: async () => null,
    loadWorkTemplateRequirementRows: async () => ({ success: true, rows: [], templateRequirementCount: 0 }),
    loadWorkTemplateSummaries: async () => [],
  }));

  const { applyWorkTemplate, getWorkTemplate, setWorkTemplateArchived } = await import('./actions');

  beforeEach(() => {
    filters = [];
    rpcCalls = [];
    authCalls = 0;
    appliedInputs = [];
  });

  test('the assignment read of a client-sent job id is scoped to the caller organization', async () => {
    const result = await applyWorkTemplate({
      templateVersionId: VERSION_ID,
      jobId: JOB_ID,
      idempotencyKey: `apply-job-${JOB_ID}-${VERSION_ID}`,
    });
    expect(result.success).toBe(true);
    const assignmentFilters = filters.filter((filter) => filter.table === 'job_assignments');
    expect(assignmentFilters).toContainEqual({
      table: 'job_assignments',
      column: 'organization_id',
      value: ORGANIZATION_ID,
    });
  });

  test('a malformed job id is refused before authentication and before any read', async () => {
    const result = await applyWorkTemplate({
      templateVersionId: VERSION_ID,
      jobId: 'not-a-uuid',
      idempotencyKey: 'apply',
    });
    expect(result).toEqual({ success: false, error: 'validation_failed' });
    expect(authCalls).toBe(0);
    expect(filters).toEqual([]);
    expect(appliedInputs).toEqual([]);
  });

  test('a non-boolean archive flag is refused before the archive RPC', async () => {
    const archived: unknown = 'yes';
    const result = await setWorkTemplateArchived(TEMPLATE_ID, archived as boolean);
    expect(result).toEqual({ success: false, error: 'validation_failed' });
    expect(authCalls).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  test('a malformed template id is refused before authentication', async () => {
    expect(await getWorkTemplate("x' or 1=1")).toEqual({ success: false, error: 'validation_failed' });
    expect(authCalls).toBe(0);
  });
}
