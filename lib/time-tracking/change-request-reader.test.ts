import { expect, test } from 'bun:test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { ID_BATCH_SIZE } from '@/lib/supabase/query-batches';
import { readPendingChangeRequestData } from './change-request-reader';

const orgId = '00000000-0000-4000-8000-000000000001';
const entryIds = Array.from({ length: 1201 }, (_, index) => `10000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
function idsFrom(url: URL, field: string): string[] {
  return (url.searchParams.get(field) ?? '').replace(/^in\.\(/, '').replace(/\)$/, '').split(',').filter(Boolean);
}
function clientWithFetch(fetcher: (url: URL) => Response | Promise<Response>): SupabaseClient<Database> {
  const request: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]): Promise<Response> => fetcher(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)),
    { preconnect: () => {} },
  );
  return createClient<Database, 'public'>('http://127.0.0.1:54321', 'isolated-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: request },
  });
}

test('real PostgREST metadata reads batch every filter and retain organization and pending constraints', async () => {
  const calls: URL[] = [];
  const client = clientWithFetch(url => {
    calls.push(url);
    expect(url.searchParams.get('organization_id')).toBe(`in.(${orgId})`);
    const requests = url.pathname.endsWith('/entry_change_requests');
    const ids = idsFrom(url, requests ? 'entry_id' : 'id');
    expect(ids.length).toBeLessThanOrEqual(ID_BATCH_SIZE);
    if (requests) {
      expect(url.searchParams.get('status')).toBe('eq.pending');
      expect(url.searchParams.get('order')).toBe('id.asc');
    }
    return Response.json(ids.map(id => requests ? { id, entry_id: id, organization_id: orgId, requested_by: 'requester', status: 'pending' } : { id, user_id: 'owner' }));
  });
  const result = await readPendingChangeRequestData(client, entryIds, [orgId]);
  expect(result.error).toBeNull();
  expect(result.requests.map(request => request.entry_id)).toEqual(entryIds);
  expect(result.entryOwnerById.size).toBe(1201);
  expect(calls.filter(url => url.pathname.endsWith('/entry_change_requests'))).toHaveLength(13);
  expect(calls.filter(url => url.pathname.endsWith('/time_entries'))).toHaveLength(13);
});

test('empty pending metadata skips owner queries, and a failed batch exposes no partial metadata', async () => {
  const calls: URL[] = [];
  const empty = clientWithFetch(url => { calls.push(url); return Response.json([]); });
  expect((await readPendingChangeRequestData(empty, entryIds, [orgId])).requests).toEqual([]);
  expect(calls.every(url => url.pathname.endsWith('/entry_change_requests'))).toBe(true);
  const denied = clientWithFetch(() => Response.json({ message: 'controlled read failure', code: '42501' }, { status: 403 }));
  const result = await readPendingChangeRequestData(denied, entryIds, [orgId]);
  expect(result.error?.message).toBe('controlled read failure');
  expect(result.requests).toEqual([]);
  expect(result.entryOwnerById.size).toBe(0);
});
