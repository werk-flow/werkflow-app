// The actual retention route and run over in-memory database functions
// (werk-flow/werkflow-planning#331). Without the cron secret nothing runs.
// The run applies every due report page by page, goes on past a failed one,
// answers a server error then, and its body and logs carry counts and codes
// only, never a report's content.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';

const secret = 'synthetic-cron-secret-0123456789abcdef';
const privateText = 'Herr Mustermann, Hauptstraße 1, 0170 1234567';

// Ids in order; the outcome each apply call answers.
let due: string[] = [];
let outcomes = new Map<string, 'originals_deleted' | 'report_deleted' | 'fail'>();
const listCalls: Array<{ after: unknown; limit: unknown }> = [];
const applied: string[] = [];
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

mock.module('server-only', () => ({}));
mock.module('next/server', () => ({ ...nextServer, connection: async () => {} }));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'list_problem_reports_due_for_retention') {
        listCalls.push({ after: args.p_after, limit: args.p_limit });
        const after = typeof args.p_after === 'string' ? args.p_after : '';
        const limit = typeof args.p_limit === 'number' ? args.p_limit : 0;
        return { data: due.filter((id) => id > after).slice(0, limit), error: null };
      }
      if (name === 'apply_problem_report_retention') {
        const id = String(args.p_report_id);
        applied.push(id);
        const outcome = outcomes.get(id);
        if (outcome === 'fail') return { data: null, error: { code: '57014', message: privateText } };
        due = due.filter((entry) => entry !== id);
        return { data: outcome ?? 'not_due', error: null };
      }
      throw new Error(`unexpected function ${name}`);
    },
  }),
}));

const { GET } = await import('../../../app/api/problem-report-retention/route');
const request = (authorization?: string) =>
  new Request('https://app.example.test/api/problem-report-retention', {
    headers: authorization ? { authorization } : {},
  });
const id = (index: number): string => `33100000-0000-4000-8000-${String(index).padStart(12, '0')}`;

// Without a configured secret nothing runs, and the operator sees a server error.
delete process.env.CRON_SECRET;
assert.equal((await GET(request(`Bearer ${secret}`))).status, 503);
// A request without the secret, or with another one, finds no route.
process.env.CRON_SECRET = secret;
for (const authorization of [undefined, 'Bearer wrong', secret]) {
  assert.equal((await GET(request(authorization))).status, 404, `${authorization} reached the run`);
}
assert.equal(listCalls.length + applied.length, 0, 'a refused request ran the retention');

// More due reports than one page: every one is applied, in id order.
due = Array.from({ length: 205 }, (_, index) => id(index + 1));
outcomes = new Map(
  due.map((entry, index) => [entry, index % 2 === 0 ? 'originals_deleted' : 'report_deleted']),
);
const done = await GET(request(`Bearer ${secret}`));
assert.equal(done.status, 200);
assert.deepEqual(await done.json(), { ok: true, originalsDeleted: 103, reportsDeleted: 102, failed: 0 });
assert.equal(applied.length, 205);
assert.deepEqual(applied, [...applied].sort(), 'the run left id order');
assert.equal(listCalls[0]?.after, undefined, 'the first page did not start at the beginning');

// A failed deletion stays due, the next report is still applied, and the
// route answers a server error with counts only.
applied.length = 0;
due = [id(1), id(2), id(3)];
outcomes = new Map([
  [id(1), 'fail'],
  [id(2), 'originals_deleted'],
  [id(3), 'report_deleted'],
]);
const failed = await GET(request(`Bearer ${secret}`));
assert.equal(failed.status, 500);
const body = await failed.text();
assert.deepEqual(JSON.parse(body), { ok: false, originalsDeleted: 1, reportsDeleted: 1, failed: 1 });
assert.deepEqual(applied, [id(1), id(2), id(3)]);
assert.deepEqual(due, [id(1)], 'the failed report left the due list');
assert.ok(!body.includes('Mustermann'), 'the body carried report content');
assert.ok(
  logged.length > 0 && logged.every((line) => !line.includes('Mustermann') && !line.includes(id(1))),
  'a log line carried report content or a report id',
);
