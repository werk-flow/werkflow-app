// Isolated framework/provider seams; the actual route, aggregate reader and auth resolver run below.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { CalendarWindowInput, CalendarWindowResult } from '@/lib/calendar/actions';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';

const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
let authenticated = true;
let memberships: Array<{ orgId: string; role: 'admin' | 'buero' | 'employee' }> = [{ orgId: organizationId, role: 'admin' }];
let activeCookie = organizationId;
let reads = 0;
let authReads = 0;
let membershipReads = 0;
let failRead = false;
const empty: CalendarWindowResult = { success: true, entries: [], jobs: [], changeRequestMap: {}, vacation: [], sickness: [], holidays: { holidayRegion: null, holidayRegionHistory: [], closureDays: [] } };
const input: CalendarWindowInput = { organizationId, from: '2026-06-14T22:00:00.000Z', to: '2026-06-15T21:59:59.999Z', fromDate: '2026-06-15', toDate: '2026-06-15' };
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

const { authenticateAndAuthorize } = await import('@/lib/jobs/auth');
const readEmpty = async () => { assert.equal((await authenticateAndAuthorize()).success, true); reads++; if (failRead) throw new Error('sensitive upstream details'); return { success: true, entries: [] }; };
mock.module('@/lib/time-tracking/actions', () => ({ getTimeEntries: readEmpty, getChangeRequestsForEntries: async () => ({ success: true, requests: [] }) }));
mock.module('@/lib/planning/actions', () => ({ getPlanningEntries: readEmpty }));
mock.module('@/lib/vacation/actions', () => ({ getVacationCalendarEntries: readEmpty }));
mock.module('@/lib/sickness/actions', () => ({ getSicknessCalendarEntries: readEmpty }));
mock.module('@/lib/personnel/calendar-reader', () => ({ readOrganizationCalendar: async () => { await readEmpty(); return empty.success ? empty.holidays : null; } }));
const { GET } = await import('@/app/api/calendar-window/route');
async function readWindowRequest(request: Request): Promise<Awaited<ReturnType<typeof GET>>> {
  const authBefore = authReads;
  const membershipsBefore = membershipReads;
  const result = await GET(request);
  assert.equal(authReads - authBefore, 1, 'the real GET and constituent guards share one verified identity');
  assert.ok(membershipReads - membershipsBefore <= 1, 'membership wrapper reads are scoped by caller');
  return result;
}
const request = (values: CalendarWindowInput = input): Request => new Request(`http://localhost/api/calendar-window?${new URLSearchParams(values)}`);
async function check(response: Response, status: number): Promise<unknown> {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return response.json();
}
authenticated = false;
assert.deepEqual(await check(await readWindowRequest(request()), 401), { success: false, error: 'not_authenticated' });
assert.equal(reads, 0);
authenticated = true;
memberships = [];
assert.deepEqual(await check(await readWindowRequest(request()), 403), { success: false, error: 'no_active_org' });
assert.equal(reads, 0);
memberships = [{ orgId: organizationId, role: 'admin' }];
activeCookie = foreignOrg;
assert.deepEqual(await check(await readWindowRequest(request({ ...input, organizationId: foreignOrg })), 403), { success: false, error: 'organization_changed' });
assert.equal(reads, 0);
activeCookie = organizationId;
for (const invalid of [
  { ...input, fromDate: '2026-02-30' },
  { ...input, fromDate: '2024-01-01' },
  { ...input, from: '2020-01-01T00:00:00Z' },
  { ...input, to: '2026-06-14T00:00:00Z' },
]) {
  assert.deepEqual(await check(await readWindowRequest(request(invalid)), 400), { success: false, error: 'invalid_input' });
  assert.equal(reads, 0);
}
for (const suffix of ['', `?organizationId=${organizationId}&organizationId=${foreignOrg}`]) {
  assert.deepEqual(await check(await GET(new Request(`http://localhost/api/calendar-window${suffix}`)), 400), { success: false, error: 'invalid_input' });
}
for (const role of ['admin', 'buero', 'employee'] as const) {
  memberships = [{ orgId: organizationId, role }];
  assert.deepEqual(await check(await readWindowRequest(request()), 200), empty);
}
assert.equal(reads, 15);
failRead = true;
assert.deepEqual(await check(await readWindowRequest(request()), 500), { success: false, error: 'unexpected_error' });

// The real client starts both reads before either response resolves. No Server Action dispatch is used.
const originalFetch = globalThis.fetch;
const pending: Array<{ url: URL; init: RequestInit | undefined; resolve: (response: Response) => void }> = [];
globalThis.fetch = Object.assign((target: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => new Promise((resolve) => {
  const url = new URL(target instanceof Request ? target.url : String(target), 'http://localhost');
  pending.push({ url, init, resolve });
}), { preconnect: originalFetch.preconnect });
try {
  const { getCalendarWindow } = await import('@/lib/calendar/client');
  const first = getCalendarWindow(input);
  const second = getCalendarWindow({ ...input, fromDate: '2026-06-01', toDate: '2026-06-30' });
  assert.equal(pending.length, 2);
  for (const item of pending) {
    assert.equal(item.url.pathname, '/api/calendar-window');
    assert.equal(item.url.searchParams.get('organizationId'), organizationId);
    assert.equal(item.init?.credentials, 'same-origin');
    assert.equal(item.init?.cache, 'no-store');
    assert.equal(item.init?.method ?? 'GET', 'GET');
  }
  const [firstPending, secondPending] = pending;
  assert.ok(firstPending && secondPending, 'both reads must be pending');
  secondPending.resolve(Response.json(empty));
  assert.deepEqual(await second, empty);
  firstPending.resolve(Response.json({ success: false, error: 'organization_changed' }, { status: 403 }));
  assert.deepEqual(await first, { success: false, error: 'organization_changed' });
  // Required<> makes a new optional domain field demand an explicit fixture
  // value; deep equality then catches a parser silently stripping that field.
  const populated: CalendarWindowResult = {
    success: true,
    entries: [{
      id: 'entry-one', userId: 'worker-one', organizationId, entryType: 'clock_in',
      timestamp: '2026-06-15T07:00:00Z', isManual: true, jobId: 'job-one', status: 'pending',
      reviewedBy: null, reviewedAt: null, createdAt: '2026-06-15T06:00:00Z', updatedAt: '2026-06-15T06:30:00Z',
      activityKind: 'work', canonicalSegmentId: 'segment-one', sourceKind: 'correction_application',
      sourceVersion: 'source-version-one', correctionApplicationId: 'application-one',
      correctionSourceFingerprint: 'fingerprint-one', pendingCorrectionRequestId: 'correction-one',
      pendingCorrectionKind: 'edit', isProvisionalCorrection: true,
    } satisfies Required<TimeEntry>],
    jobs: [{
      id: 'occurrence-one', occurrenceId: 'occurrence-one', jobId: 'job-one', seriesId: 'series-one',
      seriesLineageId: 'lineage-one', entryKind: 'job_visit', internalType: null, timeKind: 'timed',
      startAt: '2026-06-15T07:00:00Z', endAt: '2026-06-15T08:00:00Z', endDateExclusive: null,
      isException: true, version: 4, executionVersion: 7, occurrenceStatus: 'scheduled',
      assignedEmployeeRecordIds: ['employee-one'], jobNumber: 'A-001', title: 'Heizung warten',
      status: 'in_bearbeitung', priority: 'hoch', plannedDate: '2026-06-15', plannedTime: '09:00',
      estimatedDurationMinutes: 60, plannedWorkingMinutes: 55, location: 'Werkstatt',
      clientName: 'Testkunde', clientAddress: 'Teststraße 1', projectName: 'Heizungsanlage',
      projectNumber: 'P-001', assignedUserIds: ['worker-one'],
    } satisfies Required<CalendarJob>],
    changeRequestMap: {
      'entry-one': {
        id: 'request-one', entryId: 'entry-one', pairedEntryId: 'entry-two', organizationId,
        requestedBy: 'worker-one', changeType: 'edit', proposedTimestamp: '2026-06-15T07:00:00Z',
        originalTimestamp: '2026-06-15T06:30:00Z', status: 'pending', reviewedBy: null, reviewedAt: null,
        createdAt: '2026-06-15T06:00:00Z', updatedAt: '2026-06-15T06:30:00Z',
      },
    },
    holidays: { holidayRegion: 'BY', holidayRegionHistory: [{ region: 'BY', effectiveFrom: '2026-01-01T00:00:00Z' }], closureDays: [{ id: 'closure-one', closureDate: '2026-06-15', label: 'Betriebsruhe' }] },
    vacation: [{ id: 'vacation-one', employeeRecordId: 'employee-one', personName: 'Testperson', startDate: '2026-06-15', endDate: '2026-06-16', dayPortion: 'half_day', status: 'pending' }],
    sickness: [{ id: 'sickness-one', employeeRecordId: 'employee-two', personName: 'Zweite Testperson', startDate: '2026-06-15', endDate: '2026-06-30', dayPortion: 'full', openEnded: true }],
  };
  const populatedRead = getCalendarWindow(input);
  const populatedPending = pending.at(-1);
  assert.ok(populatedPending, 'expected a pending read');
  populatedPending.resolve(Response.json(populated));
  assert.deepEqual(await populatedRead, populated);
  for (const response of [
    Response.json({ success: true }),
    Response.json({ ...empty, jobs: [{ id: 'broken' }] }),
    Response.json(empty, { status: 500 }),
    new Response('<html>upstream failure</html>', { status: 502 }),
  ]) {
    const result = getCalendarWindow(input);
    const failurePending = pending.at(-1);
    assert.ok(failurePending, 'expected a pending read');
    failurePending.resolve(response);
    assert.deepEqual(await result, { success: false, error: 'calendar_read_failed' });
  }
} finally { globalThis.fetch = originalFetch; }

// Request lifetimes, concurrent callers, failures, and non-GET isolation use the actual cache.
const { withReadRequest, memoizeRequestRead } = await import('@/lib/data/read-request-cache');
let loadCount = 0;
let rejectRead = false;
const identityRead = memoizeRequestRead(async (identity: string) => {
  loadCount++;
  await Promise.resolve();
  if (rejectRead) throw new Error('read rejected');
  return { identity, role: memberships[0]?.role ?? null };
});
const inScope = (read: () => Promise<unknown>) => withReadRequest(new Request('http://localhost/read'), read);
// The same identity in both requests: only separate per-request stores load it twice.
await Promise.all(['office', 'office'].map((identity) => inScope(async () => {
  const first = identityRead(identity);
  const second = identityRead(identity);
  assert.equal(first, second, 'share in-flight work within this request');
  assert.equal((await first).identity, identity);
})));
assert.equal(loadCount, 2, 'overlapping requests keep separate stores');
memberships = [];
await inScope(async () => { assert.equal((await identityRead('office')).role, null); });
assert.equal(loadCount, 3, 'a subsequent request observes changed access');
rejectRead = true;
await assert.rejects(inScope(() => identityRead('office')), /read rejected/);
rejectRead = false;
await inScope(() => identityRead('office'));
assert.equal(loadCount, 5, 'failed promises do not escape their request');
await Promise.all([identityRead('office'), identityRead('office')]);
assert.equal(loadCount, 7, 'outside an explicit request React controls reuse');
assert.throws(() => withReadRequest(new Request('http://localhost/read', { method: 'POST' }), async () => null), /requires GET/);
