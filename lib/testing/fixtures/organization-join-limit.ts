// Actual requestOrganizationJoin and code generator with only identity,
// cookies and the database replaced: wrong codes are counted per user and
// refused after the limit, a right code creates one open join request and no
// membership, and codes come from the cryptographic random source.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createInMemoryAdmin, type InMemoryTables } from './in-memory-admin';

const organizationId = '10000000-0000-4000-8000-000000000001';
const validCode = 'ABCDEF';
const tables: InMemoryTables = {
  organizations: [{ id: organizationId, admin_id: 'owner', name: 'Fixture company', unique_code: validCode }],
  organization_members: [],
  organization_join_requests: [],
  // Another user's failures never count against the caller.
  organization_join_attempts: Array.from({ length: 10 }, (_, index) => ({
    id: `other-${index}`,
    user_id: 'other',
    attempted_at: new Date().toISOString(),
  })),
};
const callerAttempts = (): Array<Record<string, unknown>> =>
  (tables.organization_join_attempts ?? []).filter((row) => row.user_id === 'caller');
const members = (): Array<Record<string, unknown>> => tables.organization_members ?? [];
const joinRequests = (): Array<Record<string, unknown>> => tables.organization_join_requests ?? [];
const cookiesSet: string[] = [];

mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    set: (name: string) => {
      cookiesSet.push(name);
    },
  }),
}));
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () =>
    createInMemoryAdmin(tables, {
      organization_join_attempts: () => ({ attempted_at: new Date().toISOString() }),
      organization_join_requests: () => ({ status: 'pending', requested_at: new Date().toISOString() }),
    }),
}));
mock.module('@/lib/data/cached', () => ({
  CACHE_TAGS: { memberCount: () => 'member-count' },
  getAuthenticatedUser: async () => ({ id: 'caller' }),
  getCachedMemberships: async () => [],
}));
const { requestOrganizationJoin } = await import('@/lib/org/join-request-actions');
const { generateRandomCode } = await import('@/lib/org/generate-code');
const { ORGANIZATION_CODE_CHARSET, ORGANIZATION_CODE_LENGTH } = await import('@/lib/org/schemas');
const codePattern = new RegExp(`^[${ORGANIZATION_CODE_CHARSET}]{${ORGANIZATION_CODE_LENGTH}}$`);

// An empty code is refused before anything is counted or looked up.
assert.deepEqual(await requestOrganizationJoin('  '), { success: false, error: 'code_required' });
assert.equal(callerAttempts().length, 0);

// Ten wrong guesses are answered and recorded; the eleventh attempt is
// refused before the code is looked up, even when it is the right code.
for (let attempt = 0; attempt < 10; attempt += 1) {
  assert.deepEqual(await requestOrganizationJoin('ZZZZZZ'), { success: false, error: 'invalid_code' });
}
assert.equal(callerAttempts().length, 10);
assert.deepEqual(await requestOrganizationJoin('ZZZZZZ'), { success: false, error: 'too_many_attempts' });
assert.deepEqual(await requestOrganizationJoin(validCode), { success: false, error: 'too_many_attempts' });
assert.equal(callerAttempts().length, 10);
assert.deepEqual(joinRequests(), []);

// After the window has passed the caller may ask to join; expired rows are
// removed. The right code, in any case, creates an open request and no
// membership, and no organization cookie is set.
for (const row of callerAttempts()) row.attempted_at = new Date(Date.now() - 61 * 60 * 1000).toISOString();
const requested = await requestOrganizationJoin(' abcdef ');
assert.ok(requested.success);
assert.deepEqual(
  { ...requested.request, id: 'generated' },
  { id: 'generated', organizationId, organizationName: 'Fixture company', status: 'pending' },
);
assert.equal(callerAttempts().length, 0);
assert.equal((tables.organization_join_attempts ?? []).length, 10);
assert.deepEqual(
  joinRequests().map((row) => [row.id, row.user_id, row.organization_id, row.status]),
  [[requested.request.id, 'caller', organizationId, 'pending']],
);
assert.deepEqual(members(), []);
assert.deepEqual(cookiesSet, []);

// A second submit returns the open request instead of creating another one.
const repeated = await requestOrganizationJoin(validCode);
assert.equal(repeated.success, false);
assert.ok(!repeated.success && repeated.error === 'request_pending');
assert.equal(repeated.request.id, requested.request.id);
assert.equal(joinRequests().length, 1);

// Codes never come from Math.random, and a byte that would bias the charset is drawn again.
Math.random = (): number => {
  throw new Error('organization codes must not use Math.random');
};
for (let index = 0; index < 200; index += 1) assert.match(generateRandomCode(), codePattern);
const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
let draws = 0;
crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => {
  if (array instanceof Uint8Array) array.fill(draws === 0 ? 255 : 0);
  draws += 1;
  return array;
}) as typeof crypto.getRandomValues;
try {
  assert.equal(generateRandomCode(), 'AAAAAA');
  assert.equal(draws, 2);
} finally {
  crypto.getRandomValues = originalGetRandomValues;
}
