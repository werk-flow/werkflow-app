// Test-only location and process isolation keep mocks out of application code.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { getMembershipAccessMode } from '@/lib/personnel/lifecycle';

type Candidate = Parameters<typeof getMembershipAccessMode>[0] & { orgId: string };
const caller = { id: 'caller', email: 'current@example.test', user_metadata: {} };
let authenticated = true;
let memberships: Candidate[] = [];
let membershipReadError = false;
let cachedMembershipReads = 0;
let now = Date.parse('2026-09-07T10:00:00Z');
let dataReads = 0;
let authUpdates = 0;
let rpcCalls = 0;
let transitionResponse: unknown = { error: 'challenge_not_found' };
let authError: { status: number } | null = null;
const operations: string[] = [];
const profileRows = [
  { id: 'colleague', first_name: 'Current', last_name: 'Colleague' },
  { id: 'former', first_name: 'Former', last_name: 'Employee' },
  { id: 'foreign', first_name: 'Foreign', last_name: 'Person' },
];
const tables: Record<string, Record<string, unknown>[]> = {
  organization_members: [
    { user_id: 'caller', organization_id: 'allowed' },
    { user_id: 'colleague', organization_id: 'allowed' },
    { user_id: 'foreign', organization_id: 'foreign' },
  ],
  employee_records: [{ user_id: 'former', organization_id: 'allowed' }],
  profiles: profileRows,
  email_change_challenges: [{ user_id: caller.id, challenge_id: '71000000-0000-4000-8000-000000000001' }],
};
type QueryResult = { data: Record<string, unknown>[]; error: { code: string } | null };
class Query implements PromiseLike<QueryResult> {
  constructor(private rows: Record<string, unknown>[], private error: { code: string } | null = null) {}
  select(): this { return this; }
  eq(column: string, value: unknown): this { return this.in(column, [value]); }
  in(column: string, values: readonly unknown[]): this {
    this.rows = this.rows.filter((row) => values.includes(row[column]));
    return this;
  }
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: QueryResult['error'] }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: this.error });
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    fulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows, error: this.error }).then(fulfilled, rejected);
  }
}

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: () => { throw new Error('Unexpected cookies read'); } }));
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({
  getAuthenticatedUser: async () => authenticated ? caller : null,
  getCachedUser: async () => ({ data: { user: authenticated ? caller : null } }),
  getCachedMemberships: async (id: string) => {
    assert.equal(id, caller.id);
    cachedMembershipReads++;
    return [{ orgId: 'allowed', role: 'admin' }];
  },
  CACHE_TAGS: { profile: (id: string) => `profile:${id}` },
}));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  from: (table: string) => {
    assert.equal(table, 'organization_members');
    return new Query(memberships.filter((item) => getMembershipAccessMode(item, now) === 'operational')
      .map((item) => ({ organization_id: item.orgId, user_id: caller.id })),
    membershipReadError ? { code: 'fixture_read_failure' } : null);
  },
}) }));
mock.module('@/lib/jobs/auth', () => ({ authenticateAndAuthorize: () => { throw new Error('Unexpected job read'); } }));
mock.module('@/lib/responsibilities/server', () => ({ getResponsibilitiesStrandedByMemberRemoval: () => [] }));
mock.module('@/lib/org/cookies', () => ({ resolveActiveOrgId: () => 'allowed' }));
mock.module('@/lib/env/server', () => ({
  getSupabaseSecretKey: () => 'fixture-only',
  getEmailOtpHashSecret: () => 'fixture-only-otp-secret',
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => { dataReads++; return new Query([...(tables[table] ?? [])]); },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'transition_email_change');
      assert.equal(args.p_user_id, caller.id);
      rpcCalls++;
      operations.push(String(args.p_operation));
      if (args.p_operation === 'complete') return { data: { status: 'completed', email: 'new@example.test' }, error: null };
      return { data: transitionResponse, error: null };
    },
    auth: { admin: { updateUserById: async (id: string) => {
      assert.equal(id, caller.id); authUpdates++; return { error: authError };
    } } },
    functions: { invoke: () => { throw new Error('Denied boundary sent mail'); } },
  }),
}));

const { getProfilesByIds } = await import('@/lib/members/actions');
const { verifyNewEmailChangeOtp, verifyCurrentEmailChangeOtp, touchPendingNewEmailVerification } =
  await import('@/lib/settings/email-change-actions');
const { getInitialEmailChangeWizardState } = await import('@/lib/settings/email-change-state');

authenticated = false;
assert.deepEqual(await getProfilesByIds(['colleague']), {});
assert.equal((await verifyCurrentEmailChangeOtp('123456')).error, 'not_authenticated');
assert.equal((await verifyNewEmailChangeOtp('123456')).error, 'not_authenticated');
assert.equal(dataReads, 0);
assert.equal(rpcCalls, 0);
authenticated = true;

for (const state of ['suspended', 'ended', 'scheduled'] as const) {
  memberships = [{ orgId: 'allowed', hasAccessBlocker: false, accessLifecycle: {
    state, scheduledState: state === 'scheduled' ? 'active' : null,
    scheduledFor: state === 'scheduled' ? '2026-09-08T10:00:00Z' : null,
  } }];
  assert.deepEqual(await getProfilesByIds(['colleague', 'former']), {}, state);
}
assert.equal(dataReads, 0, 'blocked callers must not reach service-role subject reads');
memberships = [{ orgId: 'allowed', hasAccessBlocker: false, accessLifecycle: {
  state: 'active', scheduledState: 'suspended', scheduledFor: '2026-09-07T10:01:00Z',
} }];
assert.deepEqual(await getProfilesByIds(['colleague', 'former', 'foreign']), {
  colleague: { firstName: 'Current', lastName: 'Colleague' },
  former: { firstName: 'Former', lastName: 'Employee' },
});
now = Date.parse('2026-09-07T10:01:00Z');
assert.deepEqual(await getProfilesByIds(['colleague', 'former']), {}, 'scheduled suspension takes effect without changing membership rows');
const beforeDeniedRead = dataReads;
memberships = [];
assert.deepEqual(await getProfilesByIds(['colleague', 'former']), {}, 'out-of-band revocation beats stale cached membership');
memberships = [{ orgId: 'allowed', hasAccessBlocker: false, accessLifecycle: null }];
membershipReadError = true;
assert.deepEqual(await getProfilesByIds(['colleague', 'former']), {}, 'fresh authorization errors fail closed');
membershipReadError = false;
assert.equal(dataReads, beforeDeniedRead, 'denied callers never reach admin subject reads');
assert.equal(cachedMembershipReads, 0, 'profile authorization must not consult the stale membership cache');

assert.equal((await verifyNewEmailChangeOtp('bad')).error, 'new_email_invalid_code');
assert.equal(rpcCalls, 0);
assert.equal((await touchPendingNewEmailVerification('new@example.test')).error, 'challenge_not_found');
assert.equal((await verifyNewEmailChangeOtp('123456')).error, 'challenge_not_found');
assert.equal(authUpdates, 0);
const claim = { status: 'claimed', email: 'new@example.test',
  token: '71000000-0000-4000-8000-000000000002', challengeId: '71000000-0000-4000-8000-000000000001' };
transitionResponse = claim;
assert.equal((await verifyNewEmailChangeOtp('123456')).success, true);
assert.equal(authUpdates, 1);
transitionResponse = { ...claim, status: 'completion_pending' };
assert.equal((await verifyNewEmailChangeOtp('123456')).success, true);
assert.equal(authUpdates, 1, 'reconciliation must not repeat the Auth write');
transitionResponse = claim;
authError = { status: 504 };
operations.length = 0;
assert.equal((await verifyNewEmailChangeOtp('123456')).error, 'completion_pending');
assert.deepEqual(operations, ['verify_new'], 'ambiguous Auth result must retain its claim');
authError = { status: 422 };
operations.length = 0;
assert.equal((await verifyNewEmailChangeOtp('123456')).error, 'unexpected_error');
assert.deepEqual(operations, ['verify_new', 'abandon_rejected_completion']);
tables.email_change_challenges = [{
  user_id: caller.id, challenge_id: claim.challengeId, completion_token: claim.token,
  current_email: caller.email, new_email: claim.email, status: 'pending_new',
  new_email_code_expires_at: '2026-01-01T00:00:00Z',
}];
assert.equal((await getInitialEmailChangeWizardState()).step, 'completion_pending',
  'expiry must not turn an uncertain completion into a new editable flow');
const previousAuthUpdates = authUpdates;
caller.email = claim.email;
assert.equal((await getInitialEmailChangeWizardState()).step, 'idle',
  'a confirmed Auth change can reconcile cleanup on page reload');
assert.equal(authUpdates, previousAuthUpdates);

const { deleteOwnedMailpitMessages, readOwnedMailpitOtp } = await import('@/lib/testing/local-mailpit');
const originalFetch = globalThis.fetch;
let mailDeleted = false;
let mailRequests = 0;
const deletedBatches: string[][] = [];
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url: URL, input?: RequestInit) => {
  mailRequests++;
  assert.equal(url.origin, 'http://127.0.0.1:54324');
  assert.equal(input?.redirect, 'error');
  if (input?.method === 'DELETE') {
    const body: unknown = JSON.parse(String(input.body));
    assert.deepEqual(body, { IDs: ['owned-mail'] });
    deletedBatches.push(['owned-mail']);
    mailDeleted = true;
    return new Response('{}');
  }
  if (url.pathname.startsWith('/api/v1/message/')) return Response.json({
    ID: 'owned-mail', To: [{ Address: 'owned@example.test' }], Text: '',
    HTML: '<div style="color:#123456">Code:</div><div>654321</div>',
  });
  return Response.json({ messages: [
    ...(!mailDeleted ? [{ ID: 'owned-mail', To: [{ Address: 'owned@example.test' }], Cc: null, Bcc: null }] : []),
    { ID: 'foreign-mail', To: [{ Address: 'other@example.test' }] },
    { ID: 'shared-mail', To: [{ Address: 'owned@example.test' }], Cc: [{ Address: 'other@example.test' }], Bcc: null },
  ] });
} });
try {
  for (const address of [
    'https://example.com', 'http://example.com:54324', 'http://127.0.0.1:54321',
    'http://user:password@127.0.0.1:54324', 'http://127.0.0.1:54324/mail',
    'http://127.0.0.1:54324/?target=other', 'http://127.0.0.1:54324/#other',
  ]) {
    await assert.rejects(() => readOwnedMailpitOtp(new URL(address), 'owned-mail', 'owned@example.test'));
  }
  assert.equal(mailRequests, 0, 'untrusted mailbox origins must fail before any network request');
  const mailbox = new URL('http://127.0.0.1:54324');
  assert.equal(await readOwnedMailpitOtp(mailbox, 'owned-mail', 'owned@example.test'), '654321');
  await assert.rejects(() => readOwnedMailpitOtp(mailbox, 'owned-mail', 'other@example.test'));
  await deleteOwnedMailpitMessages(mailbox, ['owned@example.test']);
  await deleteOwnedMailpitMessages(mailbox, ['owned@example.test']);
  assert.equal(deletedBatches.length, 1, 'empty or foreign message sets must never issue a DELETE');
} finally {
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
}
console.info('Account action boundaries passed');
