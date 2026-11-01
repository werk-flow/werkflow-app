import { expect, test } from 'bun:test';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { readResumeActivity } from './resume-activity';

type FakeResult = { data: Record<string, unknown> | null; error: { message: string } | null };

const RECORDED_METHODS = new Set(['from', 'select', 'eq', 'neq', 'order', 'limit']);

// A real client over a canned PostgREST answer, behind a recorder of the
// filters the reader applies, so the test pins the rule (latest non-break
// segment of the whole session) without a database.
function fakeAdmin(result: FakeResult) {
  const calls: Array<[string, unknown[]]> = [];
  const client = createClient<Database>('http://localhost:54321', 'test-only', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: Object.assign(
        async () =>
          new Response(JSON.stringify(result.error ?? (result.data === null ? [] : [result.data])), {
            status: result.error ? 500 : 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        { preconnect: fetch.preconnect },
      ),
    },
  });
  // Each builder the recorded methods return is recorded too; every method runs on the real builder.
  const recorded = <Target extends object>(target: Target): Target =>
    new Proxy(target, {
      get(inner, property, receiver) {
        const value: unknown = Reflect.get(inner, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const next: unknown = Reflect.apply(value, inner, args);
          if (typeof property !== 'string' || !RECORDED_METHODS.has(property)) return next;
          calls.push([property, args]);
          return typeof next === 'object' && next !== null ? recorded(next) : next;
        };
      },
    });
  return { admin: recorded(client), calls };
}

const workRow = {
  id: 'segment-2',
  session_id: 'session-1',
  organization_id: 'org-1',
  employee_record_id: 'employee-1',
  kind: 'work',
  allocation_kind: 'job',
  job_id: 'job-7',
  internal_type: null,
  travel_route: null,
  travel_role: null,
  standby_context: null,
  started_at: '2026-09-17T06:00:00.000Z',
  ended_at: '2026-09-17T09:00:00.000Z',
};

test('resumes the latest non-break segment of the whole session with its job', async () => {
  const { admin, calls } = fakeAdmin({ data: workRow, error: null });
  const read = await readResumeActivity(admin, 'org-1', 'session-1');
  expect(read).toEqual({
    success: true,
    activity: { kind: 'work', allocationKind: 'job', jobId: 'job-7' },
  });
  expect(calls).toContainEqual(['eq', ['organization_id', 'org-1']]);
  expect(calls).toContainEqual(['eq', ['session_id', 'session-1']]);
  expect(calls).toContainEqual(['neq', ['kind', 'break']]);
  expect(calls).toContainEqual(['order', ['started_at', { ascending: false }]]);
  expect(calls).toContainEqual(['limit', [1]]);
});

test('a session without a prior activity resumes nothing', async () => {
  const { admin } = fakeAdmin({ data: null, error: null });
  expect(await readResumeActivity(admin, 'org-1', 'session-1')).toEqual({ success: true, activity: null });
});

test('a failed read is reported, never mistaken for nothing to resume', async () => {
  const { admin } = fakeAdmin({ data: null, error: { message: 'connection reset' } });
  expect(await readResumeActivity(admin, 'org-1', 'session-1')).toEqual({
    success: false,
    error: 'load_failed',
  });
});
