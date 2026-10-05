import { expect, mock, test } from 'bun:test';
import { ID_BATCH_SIZE, ROW_PAGE_SIZE } from '@/lib/supabase/query-batches';

// An employee with years of history holds thousands of job assignments. The
// member view read them in one unpaged query (PostgREST truncates at 1,000
// rows) and put every job id into one `in()` query string (the gateway
// answers 414). Both reads are now complete and batched.
const MEMBER_ID = '30000000-0000-4000-8000-000000000001';
const MEMBER_JOB_COUNT = 2_500;
const memberJobIds = Array.from(
  { length: MEMBER_JOB_COUNT },
  (_, index) => `job-${String(index).padStart(4, '0')}`,
);
let batchSizes: Record<string, number[]> = {};
let failingTable: string | null = null;

type QueryState = { table: string; column: string | null; ids: readonly string[]; from: number; to: number };

function rowsFor(state: QueryState): unknown[] {
  const page = <Row>(rows: Row[]): Row[] => rows.slice(state.from, state.to + 1);
  if (state.table === 'job_assignments' && state.column === null)
    return page(memberJobIds.map((jobId) => ({ job_id: jobId })));
  if (state.table === 'job_assignments')
    return page(state.ids.map((jobId) => ({ job_id: jobId, user_id: 'member' })));
  if (state.table === 'jobs' && state.column === 'id') {
    return state.ids.map((id) => ({
      id,
      planned_date: id.endsWith('7') ? null : `2026-${id.slice(-2, -1)}1-01`,
      created_at: `2026-01-01T00:00:${id.slice(-2)}Z`,
      client_id: null,
      project_id: null,
    }));
  }
  return [];
}

const admin = {
  from: (table: string) => {
    const state: QueryState = { table, column: null, ids: [], from: 0, to: Number.MAX_SAFE_INTEGER };
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      in: (column: string, ids: readonly string[]) => {
        state.column = column;
        state.ids = ids;
        (batchSizes[`${table}.${column}`] ??= []).push(ids.length);
        return query;
      },
      range: (from: number, to: number) => {
        state.from = from;
        state.to = to;
        return query;
      },
      then: (resolve: (result: { data: unknown[] | null; error: { message: string } | null }) => void) =>
        resolve(
          table === failingTable
            ? { data: null, error: { message: 'boom' } }
            : { data: rowsFor(state), error: null },
        ),
    };
    return query;
  },
};

// Module mocks are process-wide and a later mock cannot add exports to an
// earlier one (another test file mocks next/cache with `updateTag` only), so
// the mocked scenario runs in its own process.
const ISOLATED = process.env.MEMBER_JOBS_BATCHING_ISOLATED === '1';

// The child Bun test process takes several seconds under host load; the 5 s default cuts it off.
test.skipIf(ISOLATED)(
  'member jobs batching passes in an isolated process',
  async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      env: { ...process.env, MEMBER_JOBS_BATCHING_ISOLATED: '1' },
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
    expect(stderr).toContain('2 pass');
  },
  30_000,
);

async function loadMemberJobs(): Promise<(typeof import('./actions'))['getJobsForMember']> {
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({
    updateTag: () => undefined,
    revalidatePath: () => undefined,
    cacheTag: () => undefined,
  }));
  mock.module('@/lib/data/cached', () => ({ CACHE_TAGS: {} }));
  mock.module('@/lib/jobs/auth', () => ({
    authenticateAndAuthorize: async () => ({
      success: true,
      context: { orgId: 'org', userId: 'user', role: 'admin', isManagerOrAbove: true },
    }),
  }));
  mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
  return (await import('./actions')).getJobsForMember;
}

test.skipIf(!ISOLATED)('member jobs are read completely and in gateway-safe id batches', async () => {
  const getJobsForMember = await loadMemberJobs();
  batchSizes = {};
  failingTable = null;
  expect(MEMBER_JOB_COUNT).toBeGreaterThan(2 * ROW_PAGE_SIZE);
  const result = await getJobsForMember(MEMBER_ID);
  if (!result.success) throw new Error(result.error);
  expect(result.jobs).toHaveLength(MEMBER_JOB_COUNT);
  expect(Object.keys(result.jobAssignmentMap)).toHaveLength(MEMBER_JOB_COUNT);
  for (const key of ['jobs.id', 'job_assignments.job_id']) {
    const sizes = batchSizes[key] ?? [];
    expect(Math.max(...sizes), key).toBeLessThanOrEqual(ID_BATCH_SIZE);
    // A full page triggers one more range read of the same batch, so count distinct batches.
    expect(sizes.length, key).toBeGreaterThanOrEqual(MEMBER_JOB_COUNT / ID_BATCH_SIZE);
  }
  expect(batchSizes['jobs.id']?.reduce((total, size) => total + size, 0)).toBe(MEMBER_JOB_COUNT);
  // The batched rows are merged back into the list order: planned date first, unplanned last.
  const plannedDates = result.jobs.map((job) => job.plannedDate);
  const firstUnplanned = plannedDates.indexOf(null);
  expect(plannedDates.slice(firstUnplanned).every((date) => date === null)).toBe(true);
  const planned = plannedDates.slice(0, firstUnplanned);
  expect(planned).toEqual([...planned].sort());
});

test.skipIf(!ISOLATED)(
  'a failed job read fails the member view instead of returning partial rows',
  async () => {
    const getJobsForMember = await loadMemberJobs();
    batchSizes = {};
    failingTable = 'jobs';
    expect(await getJobsForMember(MEMBER_ID)).toEqual({ success: false, error: 'fetch_failed' });
  },
);
