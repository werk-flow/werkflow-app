import assert from 'node:assert/strict';
import { mock } from 'bun:test';
mock.module('server-only', () => ({}));
mock.module('@/lib/jobs/auth', () => ({ authenticateAndAuthorize: async () => { throw new Error('Unexpected settings action'); } }));
let role = 'admin';
let fail = false;
const queries: Array<{ table: string; organization: string }> = [];
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  from: (table: string) => ({ select: () => ({
    eq: async (_column: string, organization: string) => {
      queries.push({ table, organization });
      if (fail) return { data: null, error: { message: 'Synthetic unavailable data' } };
      const data = table === 'organization_members' ? [{ user_id: 'caller', role }]
        : table === 'employee_records' ? [{ id: 'record', user_id: 'caller', first_name: 'Test', last_name: 'Person', exit_date: null }]
        : [];
      return { data, error: null };
    },
    in: async () => { queries.push({ table, organization: 'profile-by-owned-user' }); return { data: [], error: null }; },
  }) }),
}) }));
const { withReadRequest, getReadRequestSignal, getReadRequestPriority } = await import('@/lib/data/read-request-cache');
const { loadResponsibilityRuntimeState } = await import('@/lib/responsibilities/server');
const first = await withReadRequest(new Request('https://fixture.invalid/read'), async () => {
  const values = await Promise.all(Array.from({ length: 4 }, () => loadResponsibilityRuntimeState('organization-one')));
  assert.equal(queries.length, 6, 'Concurrent derivations must share one complete responsibility read');
  assert.ok(values.every((value) => value === values[0]));
  await loadResponsibilityRuntimeState('organization-two');
  assert.equal(queries.length, 12, 'Different organizations cannot share a result');
  return values[0];
});
assert.equal(first?.members[0]?.role, 'admin');
role = 'employee';
const second = await withReadRequest(new Request('https://fixture.invalid/read'), () => loadResponsibilityRuntimeState('organization-one'));
assert.equal(second?.members[0]?.role, 'employee', 'A new GET must observe changed permission facts');
assert.equal(queries.length, 18);
await loadResponsibilityRuntimeState('organization-one');
role = 'buero';
assert.equal((await loadResponsibilityRuntimeState('organization-one'))?.members[0]?.role, 'buero');
assert.equal(queries.length, 30, 'Outside a GET, each call must load fresh permission facts');
fail = true;
assert.equal(await withReadRequest(new Request('https://fixture.invalid/read'), () => loadResponsibilityRuntimeState('organization-one')), null);
assert.equal(getReadRequestSignal(), undefined);
assert.throws(() => withReadRequest(new Request('https://fixture.invalid/write', { method: 'POST' }), async () => null), /requires GET/);

const { fetchWithTimeout } = await import('@/lib/supabase/fetch-with-timeout');
const originalFetch = globalThis.fetch;
const capturedSignals: AbortSignal[] = [];
globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  assert.ok(init?.signal);
  capturedSignals.push(init.signal);
  return new Response('synthetic');
}, { preconnect: () => undefined });
try {
  const cancelled = new AbortController();
  const independent = new AbortController();
  await Promise.all([
    withReadRequest(new Request('https://fixture.invalid/one', { signal: cancelled.signal }), () => fetchWithTimeout('https://backend.invalid/one')),
    withReadRequest(new Request('https://fixture.invalid/two', { signal: independent.signal }), () => fetchWithTimeout('https://backend.invalid/two')),
  ]);
  cancelled.abort();
  assert.equal(capturedSignals[0]?.aborted, true, 'Abandoned GET must abort its downstream read');
  assert.equal(capturedSignals[1]?.aborted, false, 'Another GET must remain independent');
  await fetchWithTimeout('https://backend.invalid/write', { method: 'POST' });
  assert.equal(capturedSignals[2]?.aborted, false, 'A mutation must not inherit a previous GET cancellation');
  const explicit = new AbortController();
  await fetchWithTimeout('https://backend.invalid/read', { signal: explicit.signal });
  explicit.abort();
  assert.equal(capturedSignals[3]?.aborted, true, 'Caller cancellation must remain effective');
} finally { globalThis.fetch = originalFetch; }

assert.equal(getReadRequestPriority(), 'foreground');
await withReadRequest(new Request('https://fixture.invalid/background'), async () => {
  assert.equal(getReadRequestPriority(), 'background');
  await withReadRequest(new Request('https://fixture.invalid/foreground'), async () => {
    assert.equal(getReadRequestPriority(), 'foreground');
  });
  assert.equal(getReadRequestPriority(), 'background');
}, { priority: 'background' });
assert.equal(getReadRequestPriority(), 'foreground');
