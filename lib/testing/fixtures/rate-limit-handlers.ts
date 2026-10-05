// Actual invite redemption handlers (POST /api/redeem-invite and the invite
// paths of GET /auth/callback) with the real rate limiter and only identity,
// cookies and the database RPCs replaced: a reached limit answers
// too_many_attempts and redeems nothing, a limiter outage redeems nothing,
// and the database receives keyed hashes instead of the user id or address.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { NextRequest } from 'next/server';

const organizationId = '10000000-0000-4000-8000-000000000001';
const inviteCode = '20000000-0000-4000-8000-000000000001';
const callerId = '30000000-0000-4000-8000-000000000001';
const clientIp = '203.0.113.7';
type RpcCall = { name: string; args: Record<string, unknown> };
type LimiterAnswer = { data: unknown; error: { code: string; message: string } | null };

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
const rpcCalls: RpcCall[] = [];
let limiterAnswer: (call: RpcCall) => LimiterAnswer = () => ({ data: true, error: null });
const cookiesSet: string[] = [];
console.error = () => {};

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({
  cookies: async () => ({
    set: (name: string) => {
      cookiesSet.push(name);
    },
  }),
}));
mock.module('next/cache', () => ({ revalidateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: { memberships: () => 'memberships', memberCount: () => 'member-count' },
}));
mock.module('@/lib/org/cookies', () => ({ CURRENT_ORG_COOKIE: 'current_org', CURRENT_ORG_MAX_AGE: 60 }));
mock.module('@/lib/env/public', () => ({
  getSupabaseUrl: () => 'http://localhost:54321',
  getSupabasePublishableKey: () => 'fixture-publishable-key',
}));
type CookieAdapter = { set: (name: string, value: string, options: Record<string, unknown>) => void };
let cookieAdapter: CookieAdapter | null = null;
const signedInClient = {
  auth: {
    getUser: async () => ({ data: { user: { id: callerId } }, error: null }),
    // The code exchange writes the new session through the route's cookie adapter.
    exchangeCodeForSession: async () => {
      cookieAdapter?.set('sb-session', 'fixture-session', { path: '/', httpOnly: true });
      return { error: null };
    },
  },
};
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => signedInClient }));
mock.module('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
    cookieAdapter = options.cookies;
    return signedInClient;
  },
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'consume_rate_limit') return limiterAnswer({ name, args });
      assert.equal(name, 'redeem_organization_invite_for_user');
      return {
        data: [{ org_id: organizationId, org_name: 'Fixture company', already_member: false }],
        error: null,
      };
    },
  }),
}));
const { POST } = await import('@/app/api/redeem-invite/route');
const { GET } = await import('@/app/auth/callback/route');

const redemptions = (): number =>
  rpcCalls.filter((call) => call.name === 'redeem_organization_invite_for_user').length;
const limiterCalls = (): RpcCall[] => rpcCalls.filter((call) => call.name === 'consume_rate_limit');
function reset(answer: (call: RpcCall) => LimiterAnswer): void {
  rpcCalls.length = 0;
  cookiesSet.length = 0;
  limiterAnswer = answer;
}
function redeemRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/redeem-invite', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost',
      ...headers,
    },
    body: JSON.stringify({ inviteCode }),
  });
}
function callbackRequest(): NextRequest {
  return new NextRequest(`http://localhost/auth/callback?invite_code=${inviteCode}`, {
    headers: { 'x-forwarded-for': clientIp },
  });
}
const limitedAction = (action: string) => (call: RpcCall) => ({
  data: call.args.p_action !== action,
  error: null,
});

// Under the limits the handler counts the account and the client address, then redeems.
reset(() => ({ data: true, error: null }));
const allowed = await POST(redeemRequest({ 'x-forwarded-for': `${clientIp}, 10.0.0.1` }));
assert.equal(allowed.status, 200);
assert.equal(redemptions(), 1);
assert.deepEqual(cookiesSet, ['current_org']);
assert.deepEqual(
  limiterCalls().map((call) => [call.args.p_action, call.args.p_max_attempts, call.args.p_window_seconds]),
  [
    ['invite_redeem_per_user', 30, 3600],
    ['invite_redeem_per_ip', 300, 3600],
  ],
);
// The database sees keyed hashes only: neither the user id nor the address, and one hash per action.
const subjectHashes = limiterCalls().map((call) => String(call.args.p_subject_hash));
for (const hash of subjectHashes) {
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(callerId) && !hash.includes(clientIp));
}
assert.equal(new Set(subjectHashes).size, 2);

// A request without a client address keeps the per-account limit.
reset(() => ({ data: true, error: null }));
assert.equal((await POST(redeemRequest())).status, 200);
assert.deepEqual(
  limiterCalls().map((call) => call.args.p_action),
  ['invite_redeem_per_user'],
);

// The account limit and the address limit each refuse with 429 before the redemption.
for (const action of ['invite_redeem_per_user', 'invite_redeem_per_ip']) {
  reset(limitedAction(action));
  const limited = await POST(redeemRequest({ 'x-forwarded-for': clientIp }));
  assert.equal(limited.status, 429, action);
  assert.deepEqual(await limited.json(), { error: 'too_many_attempts' });
  assert.equal(redemptions(), 0, action);
  assert.deepEqual(cookiesSet, [], action);
}

// A limiter that cannot decide refuses with a retryable failure and redeems nothing.
for (const answer of [
  () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }),
  () => ({ data: null, error: null }),
]) {
  reset(answer);
  const unavailable = await POST(redeemRequest());
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'unexpected_error' });
  assert.equal(redemptions(), 0);
  assert.deepEqual(cookiesSet, []);
}

// The invite link of a signed-in user: a reached limit leads to the invite error page.
reset(limitedAction('invite_redeem_per_ip'));
const limitedLink = await GET(callbackRequest());
assert.equal(limitedLink.headers.get('location'), 'http://localhost/invite-error?error=too_many_attempts');
assert.equal(redemptions(), 0);

// A limiter outage redeems nothing and shows the failed redemption instead of a silent dashboard.
reset(() => ({ data: null, error: { code: '08006', message: 'connection failure' } }));
const unavailableLink = await GET(callbackRequest());
assert.equal(unavailableLink.headers.get('location'), 'http://localhost/invite-error?error=redeem_failed');
assert.equal(redemptions(), 0);

// After a code exchange the same outage shows the failed redemption and keeps the new session with its options.
reset(() => ({ data: null, error: { code: '08006', message: 'connection failure' } }));
const unavailableExchange = await GET(
  new NextRequest(`http://localhost/auth/callback?code=fixture-code&invite_code=${inviteCode}`, {
    headers: { 'x-forwarded-for': clientIp },
  }),
);
assert.equal(
  unavailableExchange.headers.get('location'),
  'http://localhost/invite-error?error=redeem_failed',
);
assert.match(
  unavailableExchange.headers.get('set-cookie') ?? '',
  /sb-session=fixture-session; Path=\/; HttpOnly/,
);
assert.equal(redemptions(), 0);

// Under the limit the link redeems and confirms the join.
reset(() => ({ data: true, error: null }));
const joinedLink = await GET(callbackRequest());
assert.equal(joinedLink.headers.get('location'), `http://localhost/dashboard?joined=${organizationId}`);
assert.equal(redemptions(), 1);
