// Actual proxy with only the Supabase session read replaced: an Auth service
// that cannot refresh the token is neither a signed-out visitor nor a redirect.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { AuthApiError, AuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

type SessionAnswer = { session: { access_token: string } | null; error: AuthError | null; throws?: unknown };
let answer: SessionAnswer = { session: null, error: null };
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};
mock.module('@/lib/env/public', () => ({
  getSupabaseUrl: () => 'http://auth.internal',
  getSupabasePublishableKey: () => 'publishable',
}));
mock.module('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getSession: async () => {
        if ('throws' in answer) throw answer.throws;
        return { data: { session: answer.session }, error: answer.error };
      },
    },
  }),
}));
const { proxy } = await import('../../../proxy');

async function locationFor(path: string, next: SessionAnswer): Promise<string | null> {
  answer = next;
  const response = await proxy(new NextRequest(`http://localhost${path}`));
  const location = response.headers.get('location');
  return location ? new URL(location).pathname : null;
}

for (const path of ['/dashboard', '/auftraege/A-1', '/']) {
  // A valid session passes.
  assert.equal(await locationFor(path, { session: { access_token: 'token' }, error: null }), null);
  // No session, or a refresh Auth rejected, is a signed-out visitor.
  assert.equal(await locationFor(path, { session: null, error: null }), '/login');
  assert.equal(
    await locationFor(path, {
      session: null,
      error: new AuthApiError('revoked refresh', 400, 'refresh_token_not_found'),
    }),
    '/login',
  );
  // A refresh that could not complete passes to the layout's identity check.
  assert.equal(
    await locationFor(path, {
      session: null,
      error: new AuthRetryableFetchError('private gateway detail', 503),
    }),
    null,
  );
  assert.equal(
    await locationFor(path, {
      session: null,
      error: null,
      throws: new TypeError('fetch failed: http://auth.internal/secret-token'),
    }),
    null,
  );
}
// The signup guard on /verify does not treat an unavailable Auth service as signed out either.
assert.equal(await locationFor('/verify', { session: null, error: null }), '/signup');
assert.equal(
  await locationFor('/verify', {
    session: null,
    error: new AuthRetryableFetchError('network unavailable', 0),
  }),
  null,
);

// Logs carry the error name and status only.
assert.equal(logged.length, 7);
for (const line of logged) {
  assert.match(line, /"name":"(AuthRetryableFetchError|TypeError)"/);
  assert.doesNotMatch(line, /private gateway detail|secret-token|network unavailable/);
}
