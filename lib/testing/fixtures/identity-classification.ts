// The proxy's session refresh and the server's identity check classify every
// Auth error the same way (security.md, rule 8): a rejection signs the
// visitor out in both, anything else is an availability failure in both.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type AuthError,
} from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

let current: AuthError = new AuthSessionMissingError();
console.error = () => undefined;
mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ unstable_cache: () => () => Promise.reject(new Error('unused')) }));
mock.module('@/lib/env/public', () => ({
  getSupabaseUrl: () => 'http://auth.internal',
  getSupabasePublishableKey: () => 'publishable',
}));
mock.module('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: current }) },
  }),
}));
mock.module('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: current }) },
  }),
}));

const { REJECTED_IDENTITY_CODES, AuthUnavailableError } = await import('@/lib/auth/identity-errors');
const { proxy } = await import('../../../proxy');
const { getAuthenticatedUser } = await import('@/lib/data/cached');

const errors: Array<{ error: AuthError; rejected: boolean }> = [
  ...[...REJECTED_IDENTITY_CODES].map((code) => ({
    error: new AuthApiError('rejected', 401, code),
    rejected: true,
  })),
  { error: new AuthSessionMissingError(), rejected: true },
  { error: new AuthRetryableFetchError('gateway', 503), rejected: false },
  { error: new AuthApiError('server', 500, 'unexpected_failure'), rejected: false },
  { error: new AuthApiError('gateway without code', 401, undefined), rejected: false },
  { error: new AuthApiError('rate limited', 429, 'over_request_rate_limit'), rejected: false },
];

for (const { error, rejected } of errors) {
  current = error;
  const response = await proxy(new NextRequest('http://localhost/dashboard'));
  const location = response.headers.get('location');
  const proxyRedirected = location !== null && new URL(location).pathname === '/login';

  let readerSignedOut: boolean;
  try {
    readerSignedOut = (await getAuthenticatedUser()) === null;
  } catch (thrown) {
    assert.ok(thrown instanceof AuthUnavailableError, `${error.name}/${error.code}: unexpected reader error`);
    readerSignedOut = false;
  }

  const label = `${error.name} ${error.status} ${error.code ?? 'no code'}`;
  assert.equal(readerSignedOut, rejected, `reader classification of ${label}`);
  assert.equal(proxyRedirected, readerSignedOut, `proxy and reader disagree on ${label}`);
}
