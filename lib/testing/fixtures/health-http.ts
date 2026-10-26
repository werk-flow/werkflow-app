// Actual proxy and health route; only the providers behind the checks, the
// limiter and Supabase Auth are replaced. A request without the token reaches
// no dependency, and a report names checks, never a value or a provider body.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';

const token = 'synthetic-health-token-0123456789abcdef';
const privateDetail = 'private provider detail sb_secret_synthetic';
process.env.HEALTH_CHECK_TOKEN = token;
process.env.EMAIL_OTP_HASH_SECRET = 'synthetic-otp-secret';

let limiterVerdict: 'allowed' | 'limited' | 'unavailable' = 'allowed';
let failing: string | null = null;
const reached: string[] = [];
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

function failIf(name: string): void {
  reached.push(name);
  if (failing === name) throw new Error(privateDetail);
}

mock.module('server-only', () => ({}));
// The route declares itself dynamic first; outside Next there is no request scope to ask.
mock.module('next/server', () => ({ ...nextServer, connection: async () => {} }));
mock.module('@/lib/env/public', () => ({
  getSupabaseUrl: () => 'http://supabase.internal',
  getSupabasePublishableKey: () => 'publishable',
}));
mock.module('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => {
        reached.push('proxy_session');
        return { data: { session: null }, error: null };
      },
    },
  }),
}));
mock.module('@/lib/security/rate-limit', () => ({
  consumeRateLimit: async () => {
    reached.push('limiter');
    return limiterVerdict;
  },
}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => {
    const query = {
      select: () => query,
      limit: () => query,
      abortSignal: async () => {
        reached.push('supabase_secret_key');
        return failing === 'supabase_secret_key'
          ? { error: { code: 'PGRST301', message: privateDetail } }
          : { error: null };
      },
    };
    return { from: () => query };
  },
}));
mock.module('@/lib/storage/r2', () => ({
  headStorageBucket: async () => failIf('r2_storage'),
}));
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    reached.push('supabase_publishable_key');
    assert.equal(String(input), 'http://supabase.internal/auth/v1/settings');
    assert.equal(new Headers(init?.headers).get('apikey'), 'publishable');
    return failing === 'supabase_publishable_key'
      ? Response.json({ message: privateDetail }, { status: 401 })
      : Response.json({});
  },
  { preconnect: globalThis.fetch.preconnect },
);

const { proxy } = await import('../../../proxy');
const { GET } = await import('../../../app/api/health/route');

function healthRequest(headers: Record<string, string>, method = 'GET'): nextServer.NextRequest {
  return new nextServer.NextRequest('https://app.example.test/api/health', { method, headers });
}

const allOk = {
  supabase_publishable_key: 'ok',
  supabase_secret_key: 'ok',
  r2_storage: 'ok',
  email_otp_hash_secret: 'ok',
};

// The proxy rewrites a request without the token, for every method, to a path
// with no route, so it gets the app's own unknown-route answer.
for (const [headers, method] of [
  [{}, 'GET'],
  [{ 'x-health-check-token': `${token}x` }, 'GET'],
  [{ 'x-health-check-token': token.slice(1) }, 'GET'],
  [{}, 'POST'],
  [{ authorization: `Bearer ${token}` }, 'GET'],
] as const) {
  const response = await proxy(healthRequest(headers, method));
  assert.equal(new URL(response.headers.get('x-middleware-rewrite') ?? '').pathname, '/api/health/unknown');
}
const passed = await proxy(healthRequest({ 'x-health-check-token': token }));
assert.equal(passed.headers.get('x-middleware-rewrite'), null);
assert.equal(passed.headers.get('x-middleware-next'), '1');
assert.deepEqual(reached, []);

// The handler repeats the check: no token, a wrong token, or an unset or too
// short configured token is a bare 404 that reached nothing.
for (const presented of [null, 'wrong', `${token}x`]) {
  const response = await GET(healthRequest(presented === null ? {} : { 'x-health-check-token': presented }));
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '');
}
for (const configured of ['', 'short']) {
  process.env.HEALTH_CHECK_TOKEN = configured;
  const response = await GET(healthRequest({ 'x-health-check-token': configured }));
  assert.equal(response.status, 404);
}
process.env.HEALTH_CHECK_TOKEN = token;
assert.deepEqual(reached, []);

async function report(): Promise<{ status: number; cache: string | null; body: unknown; text: string }> {
  const response = await GET(healthRequest({ 'x-health-check-token': token }));
  const text = await response.text();
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: JSON.parse(text),
    text,
  };
}

// All dependencies answer: 200 with every check named.
const healthy = await report();
assert.equal(healthy.status, 200);
assert.equal(healthy.cache, 'no-store');
assert.deepEqual(healthy.body, { ok: true, checks: allOk });
assert.equal(reached[0], 'limiter');

// One failing dependency at a time: 503 names only it, and neither the body
// nor the log carries the provider's message.
for (const name of Object.keys(allOk)) {
  failing = name;
  if (name === 'email_otp_hash_secret') delete process.env.EMAIL_OTP_HASH_SECRET;
  logged.length = 0;
  const failed = await report();
  assert.equal(failed.status, 503, name);
  assert.equal(failed.cache, 'no-store');
  assert.deepEqual(failed.body, { ok: false, checks: { ...allOk, [name]: 'failed' } });
  assert.ok(!failed.text.includes('private provider detail'));
  assert.ok(!logged.join('\n').includes('private provider detail'), logged.join('\n'));
  assert.ok(
    logged.some((line) => line.includes(`health: ${name} failed`)),
    name,
  );
  process.env.EMAIL_OTP_HASH_SECRET = 'synthetic-otp-secret';
}
failing = null;

// The limiter refuses: 429, and no dependency is asked.
limiterVerdict = 'limited';
reached.length = 0;
const limited = await report();
assert.equal(limited.status, 429);
assert.equal(limited.cache, 'no-store');
assert.deepEqual(reached, ['limiter']);

// A limiter that cannot decide does not hide the outage the checks report.
limiterVerdict = 'unavailable';
failing = 'supabase_secret_key';
const unavailable = await report();
assert.equal(unavailable.status, 503);
assert.deepEqual(unavailable.body, { ok: false, checks: { ...allOk, supabase_secret_key: 'failed' } });
