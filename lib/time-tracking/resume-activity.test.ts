import { expect, test } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readResumeActivity } from './resume-activity';

type FakeResult = { data: Record<string, unknown> | null; error: { message: string } | null };

// A minimal query chain: records the filters the reader applies and answers
// with the canned result, so the test pins the rule (latest non-break segment
// of the whole session) without a database.
function fakeAdmin(result: FakeResult) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select', 'eq', 'neq', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => result;
  return { admin: chain as unknown as SupabaseClient, calls };
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
  const read = await readResumeActivity(admin, 'session-1');
  expect(read).toEqual({
    success: true,
    activity: { kind: 'work', allocationKind: 'job', jobId: 'job-7' },
  });
  expect(calls).toContainEqual(['eq', ['session_id', 'session-1']]);
  expect(calls).toContainEqual(['neq', ['kind', 'break']]);
  expect(calls).toContainEqual(['order', ['started_at', { ascending: false }]]);
  expect(calls).toContainEqual(['limit', [1]]);
});

test('a session without a prior activity resumes nothing', async () => {
  const { admin } = fakeAdmin({ data: null, error: null });
  expect(await readResumeActivity(admin, 'session-1')).toEqual({ success: true, activity: null });
});

test('a failed read is reported, never mistaken for nothing to resume', async () => {
  const { admin } = fakeAdmin({ data: null, error: { message: 'connection reset' } });
  expect(await readResumeActivity(admin, 'session-1')).toEqual({ success: false });
});
