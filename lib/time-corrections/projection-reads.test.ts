import { expect, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { loadApprovedCorrectionProjection } from './approved-projection';
import { createPendingProjectionPort, loadPendingCorrectionProjection } from './pending-projection';

function fixture(status: 'approved' | 'submitted', failTable?: string, count = 1001) {
  const ids = Array.from({ length: count }, (_, index) => `request-${String(index).padStart(5, '0')}`);
  const snapshot = { schemaVersion: 1, facts: [] };
  const tables: Record<string, Array<Record<string, unknown>>> = {
    time_correction_requests: ids.map((id) => ({ id, organization_id: 'org', status, subject_user_id: 'subject', requested_by: 'subject', kind: 'add', current_revision: 2, updated_at: '2026-06-11T07:00:00Z' })),
    time_correction_applications: ids.map((request_id) => ({ id: `application-${request_id}`, organization_id: 'org', request_id, revision: 2, applied_at: '2026-06-11T07:00:00Z', applied_by: 'admin', source_fingerprint: 'fingerprint', applied_snapshot: snapshot })),
    time_correction_request_revisions: ids.map((request_id) => ({ organization_id: 'org', request_id, revision: 2, proposed_snapshot: snapshot })),
    time_correction_request_sources: ids.flatMap((request_id, index) => Array.from({ length: index === 0 ? 1002 : 1 }, (_, ordinal) => ({ organization_id: 'org', request_id, revision: 2, ordinal, source_kind: 'legacy_entry', source_version: '1', time_entry_id: `entry-${request_id}-${ordinal}`, time_session_id: null, time_segment_id: null, correction_application_id: null }))),
  };
  const calls: URL[] = [];
  const admin = createClient<Database>('http://localhost:54321', 'test-only', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: Object.assign(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push(url);
      const table = url.pathname.split('/').at(-1) ?? '';
      expect(url.searchParams.get('organization_id')).toBe('eq.org');
      if (table === failTable) return new Response(JSON.stringify({ message: 'secret provider detail', code: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
      let rows = tables[table] ?? [];
      for (const [column, filter] of url.searchParams) {
        if (filter.startsWith('eq.')) rows = rows.filter((row) => String(row[column]) === filter.slice(3));
        if (filter.startsWith('in.(')) {
          const values = filter.slice(4, -1).split(',').map((value) => value.replaceAll('"', ''));
          if (column === 'request_id') expect(values.length).toBeLessThanOrEqual(100);
          rows = rows.filter((row) => values.includes(String(row[column])));
        }
        // PostgREST `or=(and(a.eq.x,b.eq.y),...)`: the exact (request, revision) pairs of one batch.
        if (column === 'or') {
          const pairs = (filter.match(/and\(([^)]*)\)/g) ?? []).map((group) => group.slice(4, -1).split(',').map((term) => term.split('.eq.')));
          expect(pairs.length).toBeLessThanOrEqual(100);
          rows = rows.filter((row) => pairs.some((pair) => pair.every(([pairColumn, value]) => pairColumn !== undefined && String(row[pairColumn]) === value)));
        }
      }
      const from = Number(url.searchParams.get('offset') ?? 0);
      const limit = Math.min(1000, Number(url.searchParams.get('limit') ?? 1000));
      return new Response(JSON.stringify(rows.slice(from, from + limit)), { headers: { 'Content-Type': 'application/json' } });
    }, { preconnect: fetch.preconnect }) },
  });
  return { admin, calls };
}

test('approved projection reads requests beyond 1000 and every source page in bounded ID batches', async () => {
  const { admin, calls } = fixture('approved');
  const result = await loadApprovedCorrectionProjection(admin, { organizationId: 'org', userId: 'subject' });
  expect(result).toHaveLength(1001);
  expect(result[0]?.sources).toHaveLength(1002);
  expect(result.at(-1)?.requestId).toBe('request-01000');
  expect(calls.some((url) => url.searchParams.get('offset') === '1000' && url.pathname.endsWith('time_correction_request_sources'))).toBe(true);
  expect(calls.filter((url) => url.pathname.endsWith('time_correction_requests')).every((url) => url.searchParams.get('subject_user_id') === 'eq.subject')).toBe(true);
});

test('pending projection reads beyond 1000 and retains all current-revision sources', async () => {
  const { admin } = fixture('submitted');
  const result = await loadPendingCorrectionProjection(createPendingProjectionPort(admin), { organizationId: 'org', subjectUserId: 'subject', caller: { userId: 'manager', role: 'buero', holder: null } });
  expect(result?.requests).toHaveLength(1001);
  expect(result?.sources).toHaveLength(2002);
});

test('approved query errors and bounded overflow never become empty successful history', async () => {
  for (const table of ['time_correction_requests', 'time_correction_applications', 'time_correction_request_sources']) {
    await expect(loadApprovedCorrectionProjection(fixture('approved', table).admin, { organizationId: 'org' })).rejects.toThrow('could not be read completely');
  }
  await expect(loadApprovedCorrectionProjection(fixture('approved', undefined, 10001).admin, { organizationId: 'org' })).rejects.toThrow('could not be read completely');
});

test('pending query errors and bounded overflow remain failed projections', async () => {
  const input = { organizationId: 'org', caller: { userId: 'manager', role: 'buero' as const, holder: null } };
  for (const table of ['time_correction_requests', 'time_correction_request_revisions', 'time_correction_request_sources']) {
    expect(await loadPendingCorrectionProjection(createPendingProjectionPort(fixture('submitted', table).admin), input)).toBeNull();
  }
  expect(await loadPendingCorrectionProjection(createPendingProjectionPort(fixture('submitted', undefined, 10001).admin), input)).toBeNull();
});
