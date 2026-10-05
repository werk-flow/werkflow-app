// Actual invite redemption handler with only identity, cookies and the RPC
// replaced: a cross-site request never reaches the RPC or the organization
// cookie, and the log carries the error code only.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { NextRequest } from 'next/server';

const organizationId = '10000000-0000-4000-8000-000000000001';
const inviteCode = '20000000-0000-4000-8000-000000000001';
let rpcAnswer: { data: unknown; error: { code: string; message: string } | null } = {
  data: null,
  error: null,
};
let rpcCalls = 0;
const cookiesSet: string[] = [];
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};
// Fixture-only key for the rate limiter's subject hash; lib/security/rate-limit.test.ts covers the limits.
process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
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
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }),
    },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string) => {
      if (name === 'consume_rate_limit') return { data: true, error: null };
      rpcCalls += 1;
      return rpcAnswer;
    },
  }),
}));
const { POST } = await import('@/app/api/redeem-invite/route');

function request(headers: Record<string, string>, body: unknown = { inviteCode }): NextRequest {
  return new NextRequest('http://localhost/api/redeem-invite', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}
const sameOrigin = {
  'content-type': 'application/json',
  'sec-fetch-site': 'same-origin',
  origin: 'http://localhost',
};

// Cross-site, foreign-origin and form-encoded requests stop before identity, RPC and cookie.
rpcAnswer = {
  data: [{ org_id: organizationId, org_name: 'Fixture company', already_member: false }],
  error: null,
};
for (const headers of [
  { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
  { 'content-type': 'application/json', origin: 'https://attacker.example' },
  { 'content-type': 'text/plain', 'sec-fetch-site': 'same-origin' },
]) {
  const response = await POST(request(headers));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden_origin' });
}
for (const body of [{ inviteCode: 'not-a-uuid' }, { inviteCode: 7 }, null, 'text']) {
  const response = await POST(request(sameOrigin, body));
  assert.equal(response.status, 400);
}
assert.equal(rpcCalls, 0);
assert.deepEqual(cookiesSet, []);

// The same-origin request redeems and sets the organization cookie.
const redeemed = await POST(request(sameOrigin));
assert.equal(redeemed.status, 200);
assert.deepEqual(await redeemed.json(), {
  success: true,
  organizationId,
  organizationName: 'Fixture company',
  alreadyMember: false,
});
assert.deepEqual(cookiesSet, ['current_org']);

// An RPC failure is logged by code; the invited address goes to the caller
// (the invite-error page needs it) but never into the log.
rpcAnswer = { data: null, error: { code: 'P0001', message: 'email_mismatch::invited.person@example.com' } };
const mismatch = await POST(request(sameOrigin));
assert.equal(mismatch.status, 400);
assert.deepEqual(await mismatch.json(), {
  error: 'email_mismatch',
  invitedEmail: 'invited.person@example.com',
});
assert.deepEqual(logged, ['"RPC error redeeming invite:" {"code":"P0001"}']);
