import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

let role: 'admin' | 'buero' | 'employee' = 'admin';
let authenticated = true;
let member = true;
let holderReads = 0;
let queryReads = 0;
const admin = createClient<Database>('http://localhost:54321', 'fixture-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: Object.assign(async (target: Parameters<typeof fetch>[0]) => {
    queryReads++;
    const url = new URL(String(target));
    assert.equal(url.searchParams.get('organization_id'), 'eq.org');
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }, { preconnect: fetch.preconnect }) },
});
mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ revalidatePath() {} }));
mock.module('@/lib/data/cached', () => ({
  getAuthenticatedUser: async () => authenticated ? { id: 'caller' } : null,
  getCachedMemberships: async () => member ? [{ orgId: 'org', role }] : [],
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));
mock.module('@/lib/responsibilities/server', () => ({
  authorizeResponsibilityForTarget: async () => { throw new Error('No mutation authorization expected.'); },
  getEffectiveResponsibilityHolderForActor: async () => { holderReads++; return null; },
}));
const { getProvisionalTimeCorrectionProjection } = await import('@/lib/time-corrections/actions');
const input = { organizationId: 'org', from: '2026-06-01T00:00:00Z', to: '2026-06-30T23:59:59Z' };
for (const managerRole of ['admin', 'buero'] as const) {
  role = managerRole;
  assert.deepEqual(await getProvisionalTimeCorrectionProjection(input), { entries: [], sources: [] });
  assert.equal(holderReads, 0, 'manager visibility does not depend on an approval holder');
}
role = 'employee';
await getProvisionalTimeCorrectionProjection({ ...input, userId: 'caller' });
assert.equal(holderReads, 0, 'own-subject visibility needs no approval holder');
const beforeForeign = queryReads;
assert.deepEqual(await getProvisionalTimeCorrectionProjection({ ...input, userId: 'foreign' }), { entries: [], sources: [] });
assert.equal(queryReads, beforeForeign, 'an explicit foreign subject is denied before reading');
await getProvisionalTimeCorrectionProjection(input);
assert.equal(holderReads, 1, 'the unfiltered employee view retains delegated approval resolution');
const beforeDenied = queryReads;
member = false;
await getProvisionalTimeCorrectionProjection(input);
authenticated = false;
await getProvisionalTimeCorrectionProjection(input);
assert.equal(queryReads, beforeDenied);
assert.equal(holderReads, 1);
