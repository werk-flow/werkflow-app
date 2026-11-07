// Actual requestOrganizationJoin, rate limiter and code generator over the
// in-memory database: every join attempt is counted per user before the code
// is looked up, so parallel guesses cannot pass the hourly limit; a right code
// creates one open join request and no membership; another owner's code is
// refused; and codes come from the cryptographic random source.
import assert from 'node:assert/strict';
import { setSystemTime } from 'bun:test';
import { CALLER_ID, installActionWorld, tableRows } from './action-boundary-world';

// Fixture-only value: the secret keys the limiter's subject hash.
process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-join-limit-secret';
console.error = () => {};

// A pinned clock; the hour window passes only when the fixture moves it.
const startedAt = new Date('2026-10-05T08:00:00.000Z');
setSystemTime(startedAt);

const organizationId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '30000000-0000-4000-8000-000000000099';
const validCode = 'ABCDEF';
const world = installActionWorld(
  {
    organizations: [
      { id: organizationId, admin_id: 'owner', name: 'Fixture company', unique_code: validCode },
    ],
    organization_members: [],
    organization_join_requests: [],
  },
  { organization_join_requests: () => ({ status: 'pending', requested_at: new Date().toISOString() }) },
);

// Stands in for consume_rate_limit: the count and the record happen in one
// synchronous step, as the database function does under its per-key advisory
// lock (supabase/tests/rate_limits.sql proves the lock).
const recordedAttempts = new Map<string, number[]>();
let limiterFails = false;
world.rpc = ({ name, args }) => {
  assert.equal(name, 'consume_rate_limit');
  if (limiterFails) return { data: null, error: { code: '08006', message: 'connection failure' } };
  const key = `${String(args.p_action)}:${String(args.p_subject_hash)}`;
  const now = Date.now();
  const live = (recordedAttempts.get(key) ?? []).filter((expiresAt) => expiresAt > now);
  if (live.length >= Number(args.p_max_attempts)) {
    recordedAttempts.set(key, live);
    return { data: false, error: null };
  }
  recordedAttempts.set(key, [...live, now + Number(args.p_window_seconds) * 1000]);
  return { data: true, error: null };
};
// Each limiter call takes one service-role client; every further one is the
// action's own, which looks up the code first.
const codeLookups = (): number => world.adminClientRequests - world.rpcCalls.length;
const members = (): Array<Record<string, unknown>> => tableRows(world, 'organization_members');
const joinRequests = (): Array<Record<string, unknown>> => tableRows(world, 'organization_join_requests');

const { requestOrganizationJoin } = await import('@/lib/org/join-request-actions');
const { generateUniqueOrgCode } = await import('@/lib/org/generate-code');
const { getOrganizationCodeValidationError, normalizeOrganizationCode } = await import('@/lib/org/schemas');

// An empty code is refused before anything is counted or looked up.
assert.deepEqual(await requestOrganizationJoin('  '), { success: false, error: 'code_required' });
assert.equal(world.rpcCalls.length, 0);

// Twenty guesses sent together: exactly ten are answered, the rest are refused
// with the limit before their code is looked up, even the right code.
const together = await Promise.all(Array.from({ length: 20 }, () => requestOrganizationJoin('ZZZZZZ')));
const answers = together.map((result) => (result.success ? 'created' : result.error));
assert.equal(answers.filter((answer) => answer === 'invalid_code').length, 10, answers.join());
assert.equal(answers.filter((answer) => answer === 'too_many_attempts').length, 10, answers.join());
assert.equal(codeLookups(), 10);
assert.deepEqual(await requestOrganizationJoin(validCode), { success: false, error: 'too_many_attempts' });
assert.equal(codeLookups(), 10);
assert.deepEqual(joinRequests(), []);

// The caller's attempts never count against another person.
world.callerId = otherUserId;
assert.deepEqual(await requestOrganizationJoin('ZZZZZZ'), { success: false, error: 'invalid_code' });
world.callerId = CALLER_ID;

// The hour passes. A limit that cannot be decided refuses the attempt without a lookup.
setSystemTime(new Date(startedAt.getTime() + 61 * 60 * 1000));
limiterFails = true;
const lookupsBeforeOutage = codeLookups();
assert.deepEqual(await requestOrganizationJoin(validCode), { success: false, error: 'unexpected_error' });
assert.equal(codeLookups(), lookupsBeforeOutage);
limiterFails = false;

// After the window has passed the caller may ask to join. The right code, in
// any case, creates an open request and no membership. The world's cookie
// store has no setter, so an organization cookie write would fail here.
const requested = await requestOrganizationJoin(' abcdef ');
assert.ok(requested.success);
assert.deepEqual(
  { ...requested.request, id: 'generated' },
  { id: 'generated', organizationId, organizationName: 'Fixture company', status: 'pending' },
);
assert.deepEqual(
  joinRequests().map((row) => [row.id, row.user_id, row.organization_id, row.status]),
  [[requested.request.id, CALLER_ID, organizationId, 'pending']],
);
assert.deepEqual(members(), []);

// A second submit returns the open request instead of creating another one.
const repeated = await requestOrganizationJoin(validCode);
assert.equal(repeated.success, false);
assert.ok(!repeated.success && repeated.error === 'request_pending');
assert.equal(repeated.request.id, requested.request.id);
assert.equal(joinRequests().length, 1);

// All organizations of one person belong to one owner: a member of the
// owner's other organization still reaches the open request, but the code of
// another owner's organization is refused before any request, and a wrong
// code stays wrong.
const foreignOwnerCode = 'XYZ234';
tableRows(world, 'organizations').push({
  id: '10000000-0000-4000-8000-000000000002',
  admin_id: 'other-owner',
  name: 'Other company',
  unique_code: foreignOwnerCode,
});
members().push({
  organization_id: '10000000-0000-4000-8000-000000000003',
  user_id: CALLER_ID,
  organizations: { admin_id: 'owner' },
});
const sameOwner = await requestOrganizationJoin(validCode);
assert.ok(!sameOwner.success && sameOwner.error === 'request_pending');
assert.deepEqual(await requestOrganizationJoin(foreignOwnerCode), {
  success: false,
  error: 'admin_mismatch',
});
assert.deepEqual(await requestOrganizationJoin('ZZZZZZ'), { success: false, error: 'invalid_code' });
assert.equal(joinRequests().length, 1);

// Codes never come from Math.random, and a byte that would bias the charset is drawn again.
Math.random = (): number => {
  throw new Error('organization codes must not use Math.random');
};
for (let index = 0; index < 200; index += 1) {
  const code = await generateUniqueOrgCode();
  assert.equal(normalizeOrganizationCode(code), code);
  assert.equal(getOrganizationCodeValidationError(code), null);
}
const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
let draws = 0;
crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
  if (array instanceof Uint8Array) array.fill(draws === 0 ? 255 : 0);
  draws += 1;
  return array;
};
try {
  assert.equal(await generateUniqueOrgCode(), 'AAAAAA');
  assert.equal(draws, 2);
} finally {
  crypto.getRandomValues = originalGetRandomValues;
}
