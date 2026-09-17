// Actual route and identity/organization guards for the background read
// transport; the registered readers are replaced by explicit seams.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000001';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'admin' | 'buero' | 'employee' }> = [{ orgId: organizationId, role: 'admin' }];
let reads: Array<{ kind: string; input: unknown }> = [];
let failRead = false;
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ unstable_cache: (read: unknown) => read }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: authenticated ? { id: 'caller' } : null }, error: null }),
} }) }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, not: () => query, limit: () => query,
      then: (resolve: (result: { error: null; data: unknown[] }) => void) => {
        resolve({ error: null, data: table === 'organization_members' ? memberships.map((member) => ({
          organization_id: member.orgId, role: member.role, joined_at: '2026-01-01',
          organizations: { id: member.orgId, name: 'Fixture company', unique_code: 'fixture', employee_records: [] },
        })) : [] });
      },
    };
    return query;
  },
}) }));

const { getReadRequestPriority } = await import('@/lib/data/read-request-cache');
const { authenticateAndAuthorize } = await import('@/lib/jobs/auth');
function seam(kind: string) {
  return async (input: unknown) => {
    assert.equal(getReadRequestPriority(), 'background');
    assert.equal((await authenticateAndAuthorize()).success, true);
    reads.push({ kind, input });
    if (failRead) throw new Error('sensitive provider detail');
    return { success: true, kind, input };
  };
}
mock.module('@/lib/time-tracking/actions', () => ({
  getTimeEntries: seam('time-entries'), getTimeEntriesForJob: seam('time-entries-for-job'),
  getPendingSessions: seam('pending-sessions'), getPendingChangeRequests: seam('pending-change-requests'),
}));
mock.module('@/lib/personnel/target-actions', () => ({ getWeeklyTargets: seam('weekly-targets') }));
mock.module('@/lib/vacation/actions', () => ({
  getOwnVacationOverview: seam('own-vacation-overview'),
  getPendingVacationRequestsForApprover: seam('pending-vacation-for-approver'),
  getDecidableApprovedVacationRequests: seam('decidable-approved-vacation'),
}));
mock.module('@/lib/sickness/actions', () => ({ getOwnSicknessReports: seam('own-sickness-reports') }));
mock.module('@/lib/time-corrections/actions', () => ({
  getProvisionalTimeSummary: seam('provisional-time-summary'), getTimeCorrectionRequests: seam('time-correction-requests'),
}));
mock.module('@/lib/members/actions', () => ({ getProfilesByIds: async (userIds: string[]) => { reads.push({ kind: 'profiles-by-ids', input: userIds }); return {}; } }));
mock.module('@/lib/dispatch/actions', () => ({ getJobDispatchCards: seam('job-dispatch-cards') }));
mock.module('@/lib/qualifications/actions', () => ({ getJobQualificationDetail: seam('job-qualification-detail') }));
mock.module('@/lib/inventory/actions', () => ({ getJobMaterialLines: seam('job-material-lines') }));
mock.module('@/lib/work-artifacts/actions', () => ({ getWorkArtifacts: seam('work-artifacts') }));
mock.module('@/lib/work-lifecycle/actions', () => ({ getWorkLifecycleSnapshot: seam('work-lifecycle-snapshot') }));

const { GET } = await import('@/app/api/background-read/route');
const { BACKGROUND_READS } = await import('@/lib/data/background-reads');
function request(kind: string, input?: unknown): Request {
  const query = new URLSearchParams({ kind });
  if (input !== undefined) query.set('input', typeof input === 'string' ? input : JSON.stringify(input));
  return new Request(`http://localhost/api/background-read?${query}`);
}
async function check(request: Request, status: number, expected: unknown): Promise<void> {
  const response = await GET(request);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), expected);
}
const failure = (error: string) => ({ success: false, error });

// Identity first: no registered reader runs for an anonymous or foreign caller.
authenticated = false;
await check(request('own-vacation-overview'), 401, failure('not_authenticated'));
authenticated = true; memberships = [];
await check(request('own-vacation-overview'), 403, failure('no_active_org'));
memberships = [{ orgId: organizationId, role: 'employee' }];
await check(request('time-correction-requests', { organizationId: foreignOrg }), 403, failure('organization_changed'));
assert.equal(reads.length, 0);

// Closed registry and validated inputs.
for (const bad of [
  request('write-anything'),
  request('time-entries', { organizationId }),
  request('time-entries', '{not json'),
  request('job-dispatch-cards', { jobId: 'not-a-uuid' }),
  new Request(`${request('own-vacation-overview').url}&kind=own-sickness-reports`),
  new Request('http://localhost/api/background-read'),
]) {
  await check(bad, 400, failure('invalid_input'));
}
assert.equal(reads.length, 0);

// Every registered kind reaches exactly its reader, at background priority.
const inputs: Record<string, unknown> = {
  'time-entries': { organizationId, from: '2026-09-14T00:00:00.000Z', to: '2026-09-20T23:59:59.999Z', userId: jobId, status: 'pending' },
  'weekly-targets': { userId: jobId },
  'provisional-time-summary': { organizationId, userId: jobId },
  'profiles-by-ids': { userIds: [jobId] },
  'pending-sessions': { organizationId },
  'pending-change-requests': { organizationId },
  'time-correction-requests': { organizationId },
  'time-entries-for-job': { jobId },
  'job-dispatch-cards': { jobId },
  'job-qualification-detail': { jobId },
  'job-material-lines': { jobId },
  'work-artifacts': { targetType: 'job', targetId: jobId },
  'work-lifecycle-snapshot': { targetType: 'project', targetId: jobId },
};
// What each reader receives: some take the bare identifier, the rest the validated object.
const readerArguments: Record<string, unknown> = {
  'profiles-by-ids': [jobId],
  'pending-sessions': organizationId,
  'pending-change-requests': organizationId,
  'time-correction-requests': organizationId,
  'time-entries-for-job': jobId,
  'job-dispatch-cards': jobId,
  'job-qualification-detail': jobId,
  'job-material-lines': jobId,
  'own-vacation-overview': undefined,
  'own-sickness-reports': undefined,
  'pending-vacation-for-approver': undefined,
  'decidable-approved-vacation': undefined,
};
for (const kind of Object.keys(BACKGROUND_READS)) {
  reads = [];
  const input = inputs[kind];
  const response = await GET(request(kind, input));
  assert.equal(response.status, 200, kind);
  assert.equal(reads.length, 1, kind);
  assert.equal(reads[0]?.kind, kind);
  assert.deepEqual(reads[0]?.input, kind in readerArguments ? readerArguments[kind] : input, kind);
}

// A thrown reader never leaks its message.
failRead = true;
await check(request('own-sickness-reports'), 500, failure('unexpected_error'));

// The client starts every read at once and treats a bad envelope as a failure.
const { readInBackground } = await import('@/lib/data/background-read-client');
const originalFetch = globalThis.fetch;
const pending: Array<{ url: URL; init: RequestInit | undefined; resolve: (response: Response) => void }> = [];
globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => pending.push({ url: new URL(String(input), 'http://localhost'), init, resolve })), { preconnect: originalFetch.preconnect });
try {
  const first = readInBackground('own-vacation-overview', {});
  const second = readInBackground('job-dispatch-cards', { jobId });
  assert.equal(pending.length, 2, 'both reads start without waiting for a Server Action');
  for (const item of pending) {
    assert.equal(item.url.pathname, '/api/background-read');
    assert.equal(item.init?.cache, 'no-store'); assert.equal(item.init?.credentials, 'same-origin');
    assert.equal(item.init?.method ?? 'GET', 'GET');
  }
  assert.equal(pending[1]?.url.searchParams.get('input'), JSON.stringify({ jobId }));
  const cards = { success: true, cards: [] };
  pending[1]?.resolve(Response.json(cards)); assert.deepEqual(await second, cards);
  pending[0]?.resolve(Response.json({ success: true, overview: null })); assert.deepEqual(await first, { success: true, overview: null });
  for (const response of [Response.json({ overview: 1 }), Response.json({ success: true }, { status: 500 }), new Response('private upstream detail', { status: 502 })]) {
    const result = readInBackground('own-vacation-overview', {}); pending.at(-1)?.resolve(response);
    assert.deepEqual(await result, { success: false, error: 'background_read_failed' });
  }
  const denied = readInBackground('own-vacation-overview', {}); pending.at(-1)?.resolve(Response.json(failure('not_authorized'), { status: 403 }));
  assert.deepEqual(await denied, failure('not_authorized'));
} finally { globalThis.fetch = originalFetch; }
