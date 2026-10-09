// Actual route and identity/organization guards for the background read
// transport; the registered readers are replaced by explicit seams.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
} from '@supabase/supabase-js';

const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000001';
// What Supabase Auth answers the identity check: a user, a returned error, or a thrown failure.
let identity: { user: { id: string } | null; error: AuthError | null; throws?: unknown } = {
  user: { id: 'caller' },
  error: null,
};
let memberships: Array<{ orgId: string; role: 'admin' | 'buero' | 'employee' }> = [
  { orgId: organizationId, role: 'admin' },
];
let membershipReads = 0;
let reads: Array<{ kind: string; input: unknown }> = [];
let failRead = false;
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(
    parts
      .map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : JSON.stringify(part)))
      .join(' '),
  );
};
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ unstable_cache: (read: unknown) => read }));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => {
        if ('throws' in identity) throw identity.throws;
        return { data: { user: identity.user }, error: identity.error };
      },
    },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'organization_members') membershipReads += 1;
      const query = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: () => query,
        then: (resolve: (result: { error: null; data: unknown[] }) => void) => {
          resolve({
            error: null,
            data:
              table === 'organization_members'
                ? memberships.map((member) => ({
                    organization_id: member.orgId,
                    role: member.role,
                    joined_at: '2026-01-01',
                    organizations: {
                      id: member.orgId,
                      name: 'Fixture company',
                      unique_code: 'fixture',
                      employee_records: [],
                    },
                  }))
                : [],
          });
        },
      };
      return query;
    },
  }),
}));

const { getReadRequestPriority } = await import('@/lib/data/read-request-cache');
const { authenticateAndAuthorize } = await import('@/lib/jobs/auth');
function seam(kind: string) {
  return async (...readerArguments: unknown[]) => {
    assert.equal(getReadRequestPriority(), 'background');
    assert.equal((await authenticateAndAuthorize()).success, true);
    const input = readerArguments.length > 1 ? readerArguments : readerArguments[0];
    reads.push({ kind, input });
    if (failRead) throw new Error('sensitive provider detail');
    return { success: true, kind, input };
  };
}
mock.module('@/lib/time-tracking/actions', () => ({
  getTimeEntries: seam('time-entries'),
  getTimeEntriesForJob: seam('time-entries-for-job'),
  getTimeEntriesForProjectJobs: seam('project-job-time-entries'),
  getPendingSessions: seam('pending-sessions'),
  getPendingChangeRequests: seam('pending-change-requests'),
}));
mock.module('@/lib/personnel/target-actions', () => ({ getWeeklyTargets: seam('weekly-targets') }));
mock.module('@/lib/vacation/actions', () => ({
  getOwnVacationOverview: seam('own-vacation-overview'),
  getPendingVacationRequestsForApprover: seam('pending-vacation-for-approver'),
  getDecidableApprovedVacationRequests: seam('decidable-approved-vacation'),
}));
mock.module('@/lib/sickness/actions', () => ({
  getOwnSicknessReports: seam('own-sickness-reports'),
  getSicknessReportsForRecord: seam('sickness-reports-for-record'),
}));
mock.module('@/lib/service-cases/actions', () => ({
  getServiceCaseDetailByNumber: seam('service-case-detail'),
  getServiceClientOption: seam('service-client-option'),
}));
mock.module('@/lib/attention/actions', () => ({ getAttentionOverview: seam('attention-overview') }));
mock.module('@/lib/personnel/lifecycle-actions', () => ({
  getOwnPersonnelActions: seam('own-personnel-actions'),
  getPersonnelLifecycle: seam('personnel-lifecycle'),
}));
mock.module('@/lib/time-corrections/actions', () => ({
  getProvisionalTimeSummary: seam('provisional-time-summary'),
  getTimeCorrectionRequests: seam('time-correction-requests'),
  getTimeCorrectionHistoryPage: seam('time-correction-history'),
  getTimeCorrectionFormOptions: seam('time-correction-form-options'),
}));
mock.module('@/lib/members/actions', () => ({
  getOrgMembersAction: seam('organization-member-options'),
  getProfilesByIds: async (userIds: string[]) => {
    reads.push({ kind: 'profiles-by-ids', input: userIds });
    return { success: true, profiles: {} };
  },
}));
mock.module('@/lib/jobs/actions', () => ({ getParkedJobs: seam('parked-jobs') }));
mock.module('@/lib/parking/actions', () => ({
  getJobParkingContexts: seam('job-parking-contexts'),
  getParkingResponsibleOptions: seam('parking-responsible-options'),
}));
mock.module('@/lib/planning/actions', () => ({ getPlanningOptions: seam('planning-options') }));
mock.module('@/lib/jobs/option-server', () => ({ readEntityOptions: seam('entity-options') }));
mock.module('@/lib/dispatch/actions', () => ({
  getJobDispatchCards: seam('job-dispatch-cards'),
  getDispatchOverview: seam('dispatch-overview'),
  previewDispatchReadiness: seam('dispatch-readiness'),
}));
mock.module('@/lib/qualifications/actions', () => ({
  getJobQualificationDetail: seam('job-qualification-detail'),
  getAssignmentTeamOptions: seam('assignment-team-options'),
}));
mock.module('@/lib/inventory/actions', () => ({
  getJobMaterialLines: seam('job-material-lines'),
  getInventoryPickerPage: seam('inventory-picker-page'),
  getInventoryPickerOptionsForJob: seam('job-inventory-picker-options'),
}));
mock.module('@/lib/clients/actions', () => ({ getClientRelations: seam('client-relations') }));
mock.module('@/lib/documents/actions', () => ({
  getAttachableDocuments: seam('attachable-documents'),
  getMaintenanceCoverageDocuments: seam('maintenance-coverage-documents'),
}));
mock.module('@/lib/work-artifacts/actions', () => ({ getWorkArtifacts: seam('work-artifacts') }));
mock.module('@/lib/work-lifecycle/actions', () => ({
  getWorkLifecycleSnapshot: seam('work-lifecycle-snapshot'),
  getApprovedArtifactActionsForTarget: seam('approved-artifact-actions'),
}));
mock.module('@/lib/installed-equipment/list-page-server', () => ({
  getInstalledEquipmentPage: seam('equipment-page'),
}));
mock.module('@/lib/service-cases/list-page-server', () => ({
  getServiceCasePage: seam('service-case-page'),
}));
mock.module('@/lib/installed-equipment/actions', () => ({
  getInstalledEquipmentDetailByNumber: seam('equipment-detail'),
}));
mock.module('@/lib/installed-equipment/source-options-server', () => ({
  getEquipmentSourceOptions: seam('equipment-sources'),
}));
mock.module('@/lib/time-tracking/picker-actions', () => ({ getJobsForPicker: seam('job-picker-jobs') }));
mock.module('@/lib/maintenance/actions', () => ({
  getMaintenanceWorkspace: seam('maintenance-workspace'),
  getMaintenanceEvidenceOptions: seam('maintenance-evidence-options'),
}));
mock.module('@/lib/work-templates/actions', () => ({
  getWorkTemplates: seam('work-templates'),
  getWorkTemplate: seam('work-template-detail'),
  getPublishedWorkTemplates: seam('published-work-templates'),
  getWorkTemplatePreview: seam('work-template-preview'),
}));

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
identity = { user: null, error: null };
await check(request('own-vacation-overview'), 401, failure('not_authenticated'));
identity = { user: { id: 'caller' }, error: null };
memberships = [];
await check(request('own-vacation-overview'), 403, failure('no_active_org'));
memberships = [{ orgId: organizationId, role: 'employee' }];
await check(
  request('time-correction-requests', { organizationId: foreignOrg, scope: 'approvals' }),
  403,
  failure('organization_changed'),
);
await check(
  request('service-case-page', { organizationId: foreignOrg, search: '', status: 'open', page: 1 }),
  403,
  failure('organization_changed'),
);
await check(
  request('service-case-detail', { organizationId: foreignOrg, caseNumber: 'SF-1' }),
  403,
  failure('organization_changed'),
);
await check(request('job-picker-jobs', { organizationId: foreignOrg }), 403, failure('organization_changed'));
// An entity picker of another organization, also with that organization's selected ids.
await check(
  request('entity-options', { organizationId: foreignOrg, kind: 'clients', selectedIds: [jobId] }),
  403,
  failure('organization_changed'),
);
await check(
  request('equipment-detail', { organizationId: foreignOrg, equipmentNumber: 'AN-1' }),
  403,
  failure('organization_changed'),
);
// The sources of another organization's equipment and work.
await check(
  request('equipment-sources', {
    organizationId: foreignOrg,
    equipmentId: jobId,
    work: { type: 'job', id: jobId },
  }),
  403,
  failure('organization_changed'),
);
assert.equal(reads.length, 0);

// Auth rejecting the token or session itself is a signed-out caller (401).
for (const error of [
  new AuthSessionMissingError(),
  new AuthApiError('invalid JWT', 401, 'bad_jwt'),
  new AuthApiError('revoked refresh', 400, 'refresh_token_not_found'),
  new AuthApiError('reused refresh', 400, 'refresh_token_already_used'),
  new AuthApiError('session timebox reached', 403, 'session_expired'),
  new AuthApiError('deleted user', 403, 'user_not_found'),
  new AuthApiError('banned user', 403, 'user_banned'),
]) {
  identity = { user: null, error };
  await check(request('own-vacation-overview'), 401, failure('not_authenticated'));
}

// Every other failure of the identity check is an availability failure (500):
// it is neither a signed-out caller nor access, and no membership or reader
// runs behind it. Unknown or code-less 401/403 answers belong here too, since
// a gateway or API-key problem answers with those statuses (incident 2026-09-30).
const membershipReadsBeforeFailures = membershipReads;
for (const scenario of [
  { user: null, error: new AuthRetryableFetchError('network unavailable', 0) },
  { user: null, error: new AuthApiError('private provider detail', 503, 'unexpected_failure') },
  { user: null, error: new AuthApiError('rate limited', 429, 'over_request_rate_limit') },
  { user: null, error: new AuthApiError('Invalid API key', 401, undefined) },
  { user: null, error: new AuthApiError('gateway refused', 403, undefined) },
  { user: null, error: new AuthApiError('newer server code', 401, 'code_this_sdk_does_not_know') },
  // An error outranks an accompanying user value.
  { user: { id: 'caller' }, error: new AuthApiError('partial answer', 500, 'unexpected_failure') },
  { user: null, error: null, throws: new TypeError('fetch failed: http://auth.internal/secret-token') },
]) {
  identity = scenario;
  await check(request('own-vacation-overview'), 500, failure('unexpected_error'));
}
identity = { user: { id: 'caller' }, error: null };
assert.equal(reads.length, 0);
assert.equal(membershipReads, membershipReadsBeforeFailures);
// Failure logs carry names, statuses and codes, never the provider's message or request.
assert.ok(logged.length > 0);
for (const line of logged) {
  assert.doesNotMatch(line, /private provider detail|secret-token|Invalid API key|gateway refused/);
}

// Closed registry and validated inputs.
for (const bad of [
  request('write-anything'),
  request('time-entries', { organizationId }),
  request('time-entries', '{not json'),
  request('job-dispatch-cards', { jobId: 'not-a-uuid' }),
  request('work-template-detail', { templateId: 'not-a-uuid' }),
  // The unsearched office page would set up inventory defaults, a write.
  request('inventory-picker-page', { search: '' }),
  request('dispatch-readiness', { jobId, occurrenceId: jobId }),
  request('service-case-page', { organizationId, search: '', status: 'archived', page: 1 }),
  new Request(`${request('own-vacation-overview').url}&kind=own-sickness-reports`),
  new Request('http://localhost/api/background-read'),
]) {
  await check(bad, 400, failure('invalid_input'));
}
assert.equal(reads.length, 0);

// Every registered kind reaches exactly its reader, at background priority.
const inputs: Record<string, unknown> = {
  'planning-options': {
    organizationId,
    kind: 'employees',
    query: '',
    offset: 0,
    selectedIds: [],
    defaultUserIds: [],
  },
  'organization-member-options': { organizationId },
  'entity-options': {
    organizationId,
    kind: 'projects',
    query: 'Bad',
    offset: 50,
    selectedIds: [jobId],
    purpose: 'job-project',
    clientId: jobId,
  },
  'time-entries': {
    organizationId,
    from: '2026-09-14T00:00:00.000Z',
    to: '2026-09-20T23:59:59.999Z',
    userId: jobId,
    status: 'pending',
  },
  'weekly-targets': { userId: jobId },
  'provisional-time-summary': { organizationId, userId: jobId },
  'profiles-by-ids': { userIds: [jobId] },
  'pending-sessions': { organizationId },
  'pending-change-requests': { organizationId },
  'time-correction-requests': { organizationId, scope: 'approvals' },
  'time-correction-history': { organizationId, page: 2 },
  'time-correction-form-options': { organizationId },
  'time-entries-for-job': { jobId },
  'job-dispatch-cards': { jobId },
  'job-qualification-detail': { jobId },
  'job-material-lines': { jobId },
  'work-artifacts': { targetType: 'job', targetId: jobId },
  'work-lifecycle-snapshot': { targetType: 'project', targetId: jobId },
  'equipment-page': { organizationId, search: 'kessel', category: 'all', includeArchived: true, page: 2 },
  'service-case-page': { organizationId, search: '', status: 'open', page: 1 },
  'service-case-detail': { organizationId, caseNumber: 'SF-1' },
  'service-client-option': { organizationId, clientId: jobId },
  'personnel-lifecycle': { employeeRecordId: jobId },
  'sickness-reports-for-record': { employeeRecordId: jobId },
  'job-picker-jobs': { organizationId, query: 'Heizung', limit: 100, selectedJobId: jobId },
  'dispatch-overview': { from: '2026-10-02', to: '2026-10-16' },
  'work-template-detail': { templateId: jobId },
  'project-job-time-entries': { projectId: jobId },
  'equipment-detail': { organizationId, equipmentNumber: 'AN-1' },
  'equipment-sources': { organizationId, equipmentId: jobId, work: { type: 'project', id: jobId } },
  'maintenance-workspace': { organizationId, search: 'kessel', duePage: 1, planPage: 2, coveragePage: 3 },
  'published-work-templates': { targetType: 'project' },
  'work-template-preview': { versionId: jobId, targetType: 'job', jobId },
  'approved-artifact-actions': { targetType: 'job', targetId: jobId },
  'client-relations': { clientId: jobId },
  'attachable-documents': { targetType: 'job', targetId: jobId, searchQuery: 'Plan', category: 'all' },
  'inventory-picker-page': { search: '', exactItemId: jobId },
  'job-inventory-picker-options': { jobId, search: 'Rohr', exactItemId: jobId },
  'dispatch-readiness': { occurrenceId: jobId },
  'maintenance-coverage-documents': { maintenanceCoverageId: jobId },
  'maintenance-evidence-options': { jobId },
};
// What each reader receives: some take the bare identifier, the rest the validated object.
const readerArguments: Record<string, unknown> = {
  'organization-member-options': organizationId,
  'profiles-by-ids': [jobId],
  'pending-sessions': organizationId,
  'pending-change-requests': organizationId,
  'time-correction-requests': [organizationId, 'approvals'],
  'time-correction-history': [organizationId, 2],
  'time-correction-form-options': organizationId,
  'time-entries-for-job': jobId,
  'job-dispatch-cards': jobId,
  'job-qualification-detail': jobId,
  'job-material-lines': jobId,
  'own-vacation-overview': undefined,
  'own-sickness-reports': undefined,
  'pending-vacation-for-approver': undefined,
  'decidable-approved-vacation': undefined,
  'service-case-detail': 'SF-1',
  'service-client-option': jobId,
  'attention-overview': undefined,
  'own-personnel-actions': undefined,
  'personnel-lifecycle': jobId,
  'sickness-reports-for-record': jobId,
  'dispatch-overview': ['2026-10-02', '2026-10-16'],
  'work-templates': undefined,
  'work-template-detail': jobId,
  'project-job-time-entries': jobId,
  'equipment-detail': 'AN-1',
  'published-work-templates': 'project',
  'assignment-team-options': undefined,
  'client-relations': jobId,
  'inventory-picker-page': ['', jobId],
  'job-inventory-picker-options': [jobId, 'Rohr', jobId],
  'parking-responsible-options': undefined,
  'maintenance-coverage-documents': jobId,
  'maintenance-evidence-options': jobId,
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
globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((resolve) =>
      pending.push({ url: new URL(String(input), 'http://localhost'), init, resolve }),
    ),
  { preconnect: originalFetch.preconnect },
);
try {
  const first = readInBackground('own-vacation-overview', {});
  const second = readInBackground('job-dispatch-cards', { jobId });
  assert.equal(pending.length, 2, 'both reads start without waiting for a Server Action');
  for (const item of pending) {
    assert.equal(item.url.pathname, '/api/background-read');
    assert.equal(item.init?.cache, 'no-store');
    assert.equal(item.init?.credentials, 'same-origin');
    assert.equal(item.init?.method ?? 'GET', 'GET');
  }
  assert.equal(pending[1]?.url.searchParams.get('input'), JSON.stringify({ jobId }));
  const cards = { success: true, cards: [] };
  pending[1]?.resolve(Response.json(cards));
  assert.deepEqual(await second, cards);
  pending[0]?.resolve(Response.json({ success: true, overview: null }));
  assert.deepEqual(await first, { success: true, overview: null });
  for (const response of [
    Response.json({ overview: 1 }),
    Response.json({ success: true }, { status: 500 }),
    new Response('private upstream detail', { status: 502 }),
  ]) {
    const result = readInBackground('own-vacation-overview', {});
    pending.at(-1)?.resolve(response);
    assert.deepEqual(await result, { success: false, error: 'background_read_failed' });
  }
  const denied = readInBackground('own-vacation-overview', {});
  pending.at(-1)?.resolve(Response.json(failure('not_authorized'), { status: 403 }));
  assert.deepEqual(await denied, failure('not_authorized'));
} finally {
  globalThis.fetch = originalFetch;
}
