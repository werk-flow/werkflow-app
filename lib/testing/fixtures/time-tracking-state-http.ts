// Actual route and identity/organization guards; provider/domain reads use explicit seams.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { LiveClockState, TimeActivitySelection } from '@/lib/time-tracking/types';
const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'admin' | 'buero' | 'employee' }> = [{ orgId: organizationId, role: 'admin' }];
const activeCookie = organizationId;
let reads = 0;
let authReads = 0;
let membershipReads = 0;
let failRead = false;
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: activeCookie }) }) }));
mock.module('next/cache', () => ({ unstable_cache: (read: unknown) => read }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => { authReads++; return { data: { user: authenticated ? { id: 'caller' } : null }, error: null }; },
} }) }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, not: () => query, limit: () => query,
      then: (resolve: (result: { error: null; data: unknown[] }) => void) => {
        if (table === 'organization_members') membershipReads++;
        resolve({ error: null, data: table === 'organization_members' ? memberships.map((member) => ({
          organization_id: member.orgId, role: member.role, joined_at: '2026-01-01',
          organizations: { id: member.orgId, name: 'Fixture company', unique_code: 'fixture', employee_records: [] },
        })) : [] });
      },
    };
    return query;
  },
}) }));


const state: LiveClockState = {
  organizationId, breakMode: 'manual', autoBreakThresholdMinutes: 360, autoBreakDurationMinutes: 30,
  status: 'working', isClockedIn: true, isOnBreak: false, clockInTime: '2026-09-12T07:00:00Z',
  statusStartedAt: '2026-09-12T08:00:00Z', breakStartTime: null, todayMinutes: 60, workMinutes: 55, breakMinutes: 5,
  timelineSegments: [{ type: 'work', minutes: 55 }, { type: 'break', minutes: 5 }],
  activeJobId: organizationId, activeJobInfo: { id: organizationId, title: 'Testauftrag', jobNumber: 'A-1', status: 'in_bearbeitung', projectName: 'Testprojekt', clientName: 'Testkunde' },
  captureModel: 'canonical', sessionId: organizationId, sessionVersion: 3, currentSegmentId: organizationId,
  currentActivity: { kind: 'travel', allocationKind: 'job', jobId: organizationId, travelRoute: 'company_to_site', travelRole: 'driver' },
  resumeActivity: { kind: 'travel', allocationKind: 'job', jobId: organizationId, travelRoute: 'company_to_site', travelRole: 'driver' },
  resumeJobInfo: null,
  recoveryReason: null, legacyOpen: false, standbyMinutes: 10, travelMinutes: 15, calloutMinutes: 5, internalMinutes: 25,
  fetchedAt: '2026-09-12T08:00:00Z',
};
const clock = { success: true as const, state };
const jobs = { success: true as const, activeJobIds: [organizationId], activeProjectIds: [foreignOrg] };
const { getReadRequestPriority } = await import('@/lib/data/read-request-cache');
const { authenticateAndAuthorize } = await import('@/lib/jobs/auth');
async function readDomain<T>(orgId: string, result: T): Promise<T> {
  assert.equal(getReadRequestPriority(), 'background');
  assert.equal(orgId, organizationId);
  assert.equal((await authenticateAndAuthorize()).success, true);
  reads++;
  if (failRead) throw new Error('sensitive provider detail');
  return result;
}
mock.module('@/lib/time-tracking/actions', () => ({
  getCurrentClockState: (orgId: string) => readDomain(orgId, clock),
  getActiveJobIdsForOrg: (orgId: string) => readDomain(orgId, jobs),
}));
const { GET } = await import('@/app/api/time-tracking-state/route');
const request = (kind: string, orgId = organizationId): Request => new Request(`http://localhost/api/time-tracking-state?${new URLSearchParams({ kind, organizationId: orgId })}`);
async function check(request: Request, status: number, expected: unknown): Promise<void> {
  const response = await GET(request);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), expected);
}
for (const kind of ['clock', 'active-jobs']) {
  const failure = (error: string) => ({ success: false, error });
  authenticated = false;
  await check(request(kind), 401, failure('not_authenticated'));
  authenticated = true; memberships = [];
  await check(request(kind), 403, failure('no_active_org'));
  memberships = [{ orgId: organizationId, role: 'admin' }];
  await check(request(kind, foreignOrg), 403, failure('organization_changed'));
  assert.equal(reads, 0);
}
for (const bad of [request('write'), request('clock', 'invalid'), new Request(`${request('clock').url}&kind=active-jobs`), new Request('http://localhost/api/time-tracking-state')]) {
  await check(bad, 400, { success: false, error: 'invalid_input' });
}
for (const role of ['admin', 'buero', 'employee'] as const) {
  memberships = [{ orgId: organizationId, role }];
  for (const kind of ['clock', 'active-jobs']) {
    const authBefore = authReads; const membershipBefore = membershipReads;
    await check(request(kind), 200, kind === 'clock' ? clock : jobs);
    assert.equal(authReads - authBefore, 1);
    assert.equal(membershipReads - membershipBefore, 1);
  }
}
memberships = [];
await check(request('clock'), 403, { success: false, error: 'no_active_org' });
memberships = [{ orgId: organizationId, role: 'employee' }]; failRead = true;
await check(request('clock'), 500, { success: false, error: 'unexpected_error' });

const { getCurrentClockState, getActiveJobIdsForOrg } = await import('@/lib/time-tracking/state-client');
const originalFetch = globalThis.fetch;
const pending: Array<{ url: URL; init: RequestInit | undefined; resolve: (response: Response) => void }> = [];
globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => new Promise<Response>(resolve => pending.push({ url: new URL(String(input), 'http://localhost'), init, resolve })), { preconnect: originalFetch.preconnect });
try {
  const first = getCurrentClockState(organizationId); const second = getActiveJobIdsForOrg(organizationId);
  assert.equal(pending.length, 2, 'both reads start without waiting for a Server Action');
  for (const item of pending) {
    assert.equal(item.url.pathname, '/api/time-tracking-state');
    assert.equal(item.init?.cache, 'no-store'); assert.equal(item.init?.credentials, 'same-origin');
    assert.equal(item.init?.method ?? 'GET', 'GET');
  }
  const [firstPending, secondPending] = pending;
  assert.ok(firstPending && secondPending, 'both reads must be pending');
  secondPending.resolve(Response.json(jobs)); assert.deepEqual(await second, jobs);
  firstPending.resolve(Response.json(clock)); assert.deepEqual(await first, clock);
  const activities: TimeActivitySelection[] = [
    { kind: 'work', allocationKind: 'job', jobId: organizationId },
    { kind: 'callout', allocationKind: 'unallocated', jobId: null },
    { kind: 'break', allocationKind: 'none' },
    { kind: 'standby', allocationKind: 'none', standbyContext: 'remote' },
    { kind: 'internal_activity', allocationKind: 'internal_activity', internalType: 'training' },
  ];
  for (const currentActivity of activities) {
    const result = getCurrentClockState(organizationId); const value = { ...clock, state: { ...state, currentActivity } };
    pending.at(-1)!.resolve(Response.json(value)); assert.deepEqual(await result, value);
  }
  const wrongOrg = getCurrentClockState(organizationId);
  pending.at(-1)!.resolve(Response.json({ ...clock, state: { ...state, organizationId: foreignOrg } }));
  assert.deepEqual(await wrongOrg, { success: false, error: 'organization_changed' });
  for (const response of [Response.json({ success: true }), Response.json(clock, { status: 500 }), new Response('private upstream detail', { status: 502 })]) {
    const result = getCurrentClockState(organizationId); pending.at(-1)!.resolve(response);
    assert.deepEqual(await result, { success: false, error: 'time_state_read_failed' });
  }
  const invalidJobs = getActiveJobIdsForOrg(organizationId); pending.at(-1)!.resolve(Response.json({ ...jobs, activeJobIds: [42] }));
  assert.deepEqual(await invalidJobs, { success: false, error: 'time_state_read_failed' });
} finally { globalThis.fetch = originalFetch; }
