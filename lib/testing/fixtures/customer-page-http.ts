import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { Database } from '@/lib/supabase/database.types';

const organizationId = '10000000-0000-4000-8000-000000000001';
const foreignOrg = '10000000-0000-4000-8000-000000000002';
const clientId = '10000000-0000-4000-8000-000000000003';
let authenticated = true;
let role: 'admin' | 'buero' | 'employee' | null = 'admin';
let protectedReads = 0;
let failSelection = false;
let malformedRows = false;
let foreignRows = false;
let selectedIds = [clientId];
const row: Database['public']['Tables']['clients']['Row'] = {
  id: clientId, organization_id: organizationId, name: 'Seite zwei', client_type: 'privat',
  customer_number: null, email: null, phone: null, address: null, notes: null,
  created_at: '2026-09-12T00:00:00Z', updated_at: '2026-09-12T00:00:00Z',
};
mock.module('server-only', () => ({}));
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: organizationId }) }) }));
mock.module('next/cache', () => ({ unstable_cache: (read: unknown) => read }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: authenticated ? { id: 'caller' } : null }, error: null }),
} }) }));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({
  rpc: async (name: string, input: Record<string, unknown>) => {
    protectedReads++;
    assert.equal(name, 'list_customer_page');
    assert.deepEqual(input, { p_organization_id: organizationId, p_search: 'Kontakt', p_page: 2, p_page_size: 50 });
    return { data: { ids: selectedIds, total: 61, clients: malformedRows ? [{}] : selectedIds.map(() => ({ id: row.id, organizationId: foreignRows ? foreignOrg : organizationId, name: row.name, clientType: row.client_type, customerNumber: row.customer_number, email: row.email, phone: row.phone, address: row.address, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at })) }, error: failSelection ? { message: 'private provider detail' } : null };
  },
  from: (table: string) => {
    assert.notEqual(table, 'clients', 'customer hydration must not add a second network request');
    const query = {
      select: () => query, not: () => query, limit: () => query,
      eq: (column: string, value: string) => { if (table === 'clients') { assert.equal(column, 'organization_id'); assert.equal(value, organizationId); } return query; },
      in: (column: string, values: string[]) => { assert.equal(column, 'id'); assert.deepEqual(values, selectedIds); return query; },
      then: (resolve: (result: { error: { message: string } | null; data: unknown[] }) => void) => {
        if (table === 'clients') protectedReads++;
        resolve({ error: table === 'clients' && malformedRows ? { message: 'private provider detail' } : null, data: table === 'clients' ? [row] : role ? [{
          organization_id: organizationId, role, joined_at: '2026-01-01',
          organizations: { id: organizationId, name: 'Fixture company', unique_code: 'fixture', employee_records: [] },
        }] : [] });
      },
    };
    return query;
  },
}) }));

const { GET } = await import('@/app/api/customer-page/route');
const request = (org = organizationId): Request => new Request(`http://localhost/api/customer-page?${new URLSearchParams({ organizationId: org, page: '2', search: 'Kontakt' })}`);
async function check(input: Request, status: number): Promise<unknown> {
  const response = await GET(input);
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('private provider detail'));
  return body;
}
authenticated = false; await check(request(), 401);
authenticated = true; role = null; await check(request(), 403);
role = 'employee'; await check(request(), 403);
role = 'admin'; await check(request(foreignOrg), 403);
for (const input of [request('invalid'), new Request(`${request().url}&page=3`), new Request(request().url.replace('page=2', 'page=0')), new Request(request().url.replace('page=2', 'page=1.5'))]) await check(input, 400);
assert.equal(protectedReads, 0, 'invalid or unauthorized requests cannot reach protected rows');
for (const allowedRole of ['admin', 'buero'] as const) {
  role = allowedRole;
  const data = await check(request(), 200);
  assert.deepEqual(data, { clients: [{ id: clientId, organizationId, name: row.name, clientType: row.client_type, customerNumber: null, email: null, phone: null, address: null, notes: null, createdAt: row.created_at, updatedAt: row.updated_at }], total: 61 });
}
const previousReads = protectedReads;
role = null; await check(request(), 403);
assert.equal(protectedReads, previousReads, 'later revocation must not reuse permission');
role = 'admin'; failSelection = true; await check(request(), 500);
failSelection = false; malformedRows = true; await check(request(), 500);
malformedRows = false; foreignRows = true; await check(request(), 500);
foreignRows = false; selectedIds = [];
assert.deepEqual(await check(request(), 200), { clients: [], total: 61 });
