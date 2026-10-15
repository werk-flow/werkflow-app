// Actual GET /auth/callback with only Auth, the cache and the database RPCs
// replaced: an Auth service that cannot answer is a private 503, never the
// invalid-link page; a bare invite link redeems nothing, whatever site sent
// the browser; and no provider message, invited address or invite code
// travels in a redirect URL.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { AuthApiError, AuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

const organizationId = '10000000-0000-4000-8000-000000000001';
const inviteCode = '20000000-0000-4000-8000-000000000001';
const callerId = '30000000-0000-4000-8000-000000000001';
const providerMessage = 'Token has expired or is invalid';
type AuthAnswer = { error: AuthError | null; thrown?: Error };
type RpcAnswer = { data: unknown; error: { code: string; message: string } | null };

process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
console.error = () => {};
let authAnswer: AuthAnswer = { error: null };
let redeemAnswer: RpcAnswer = { data: null, error: null };
const rpcNames: string[] = [];

mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ revalidateTag: () => {} }));
mock.module('@/lib/data/cached', () => ({ CACHE_TAGS: { memberCount: () => 'member-count' } }));
mock.module('@/lib/org/cookies', () => ({ CURRENT_ORG_COOKIE: 'current_org', CURRENT_ORG_MAX_AGE: 60 }));
mock.module('@/lib/env/public', () => ({
  getSupabaseUrl: () => 'http://localhost:54321',
  getSupabasePublishableKey: () => 'fixture-publishable-key',
}));
function answerAuth() {
  if (authAnswer.thrown) throw authAnswer.thrown;
  return authAnswer.error
    ? { data: { user: null, session: null }, error: authAnswer.error }
    : { data: { user: { id: callerId }, session: {} }, error: null };
}
mock.module('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      exchangeCodeForSession: async () => answerAuth(),
      verifyOtp: async () => answerAuth(),
      getUser: async () => ({ data: { user: { id: callerId } }, error: null }),
    },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string) => {
      rpcNames.push(name);
      return name === 'consume_rate_limit' ? { data: true, error: null } : redeemAnswer;
    },
  }),
}));
const { GET } = await import('@/app/auth/callback/route');

function callback(query: string, headers: Record<string, string> = {}): Promise<Response> {
  return GET(new NextRequest(`http://localhost/auth/callback?${query}`, { headers }));
}
function redemptions(): number {
  return rpcNames.filter((name) => name === 'redeem_organization_invite_for_user').length;
}
function assertUnavailable(response: Response, label: string): void {
  assert.equal(response.status, 503, label);
  assert.equal(response.headers.get('location'), null, label);
  assert.equal(response.headers.get('cache-control'), 'private, no-store', label);
}

const unavailableErrors: ReadonlyArray<AuthAnswer> = [
  { error: new AuthRetryableFetchError('gateway', 503) },
  { error: new AuthApiError('server', 500, 'unexpected_failure') },
  { error: new AuthApiError('gateway without code', 401, undefined) },
  { error: new AuthApiError('rate limited', 429, 'over_request_rate_limit') },
  { error: null, thrown: new Error('fetch failed') },
];

// A code exchange that cannot complete is a private 503: no invalid-link page,
// no session cookie, no redemption.
for (const answer of unavailableErrors) {
  authAnswer = answer;
  rpcNames.length = 0;
  const response = await callback(`code=fixture-code&invite_code=${inviteCode}`);
  assertUnavailable(response, `exchange ${answer.error?.name ?? 'thrown'}`);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(redemptions(), 0);
}

// The same for a token hash.
for (const answer of unavailableErrors) {
  authAnswer = answer;
  assertUnavailable(
    await callback('token_hash=fixture-hash&type=recovery'),
    `token hash ${answer.error?.name ?? 'thrown'}`,
  );
}

// Auth refusing the link itself shows the invalid-link page with a fixed code
// and without the provider's message.
for (const code of ['flow_state_not_found', 'bad_code_verifier', 'otp_expired']) {
  authAnswer = { error: new AuthApiError(providerMessage, 400, code) };
  const exchange = await callback('code=fixture-code');
  assert.equal(exchange.headers.get('location'), 'http://localhost/forgot-password?error=invalid_code', code);
  const recovery = await callback('token_hash=fixture-hash&type=recovery');
  assert.equal(recovery.headers.get('location'), 'http://localhost/reset-password?error=invalid_token', code);
  const confirmation = await callback('token_hash=fixture-hash&type=email');
  assert.equal(
    confirmation.headers.get('location'),
    'http://localhost/forgot-password?error=invalid_token',
    code,
  );
}

// A bare invite link redeems nothing and writes no cookie, whichever site
// sent the browser: it leads to the login page, where a signed-in person
// accepts with a click.
authAnswer = { error: null };
for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-origin' }, {}]) {
  rpcNames.length = 0;
  const response = await callback(`invite_code=${inviteCode}`, headers);
  assert.equal(response.headers.get('location'), `http://localhost/login?invite_code=${inviteCode}`);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(rpcNames.length, 0);
}
// A code that is not a UUID is neither redeemed nor echoed.
assert.equal((await callback('invite_code=not-a-code')).headers.get('location'), 'http://localhost/');

// After a code exchange an email_mismatch refusal names only its code in the
// URL. The invited address stays out of the URL, and the invite code goes to
// the error page in an httpOnly cookie scoped to it.
redeemAnswer = {
  data: null,
  error: { code: 'P0001', message: 'email_mismatch::invited.person@example.com' },
};
const mismatch = await callback(`code=fixture-code&invite_code=${inviteCode}`);
assert.equal(mismatch.headers.get('location'), 'http://localhost/invite-error?error=email_mismatch');
const mismatchCookies = mismatch.headers.getSetCookie();
const inviteCookie = mismatchCookies.find((cookie) => cookie.startsWith('invite_mismatch='));
assert.ok(inviteCookie, mismatchCookies.join('\n'));
assert.match(inviteCookie, new RegExp(`^invite_mismatch=${inviteCode}; Path=/invite-error; .*HttpOnly`));
assert.ok(!mismatchCookies.join('\n').includes('invited.person'));

// Another refusal names its code only; an unknown failure is redeem_failed.
redeemAnswer = { data: null, error: { code: 'P0001', message: 'invite_expired: since 2026-01-01' } };
assert.equal(
  (await callback(`code=fixture-code&invite_code=${inviteCode}`)).headers.get('location'),
  'http://localhost/invite-error?error=invite_expired',
);
redeemAnswer = { data: null, error: { code: 'XX000', message: 'internal detail' } };
assert.equal(
  (await callback(`code=fixture-code&invite_code=${inviteCode}`)).headers.get('location'),
  'http://localhost/invite-error?error=redeem_failed',
);
// An empty answer is a failure the person sees, never a silent stop.
redeemAnswer = { data: [], error: null };
assert.equal(
  (await callback(`code=fixture-code&invite_code=${inviteCode}`)).headers.get('location'),
  'http://localhost/invite-error?error=redeem_failed',
);

// A successful exchange redeems for the account the exchange signed in.
redeemAnswer = {
  data: [{ org_id: organizationId, org_name: 'Fixture company', already_member: false }],
  error: null,
};
const joined = await callback(`code=fixture-code&invite_code=${inviteCode}`);
assert.equal(joined.headers.get('location'), `http://localhost/dashboard?joined=${organizationId}`);
assert.ok(joined.headers.getSetCookie().some((cookie) => cookie.startsWith(`current_org=${organizationId}`)));
