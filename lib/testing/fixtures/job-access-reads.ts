// The shared job-access reads against a counting fake client: one read per
// fact within a GET scope, a fresh read in every other scope and outside one,
// and a failed read that stays a failure.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';

mock.module('server-only', () => ({}));
const logged: string[] = [];
mock.module('@/lib/logging', () => ({ logError: (message: string) => logged.push(message) }));

const queries: string[] = [];
let failing = false;
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const filters: string[] = [];
      const query = {
        select: () => query,
        eq: (column: string, value: string) => {
          filters.push(`${column}=${value}`);
          return query;
        },
        maybeSingle: async () => {
          queries.push(`${table}?${filters.join('&')}`);
          if (failing) return { data: null, error: { code: '57014', message: 'canceling statement' } };
          return {
            data: table === 'jobs' ? { id: 'job', project_id: null } : { id: 'assignment' },
            error: null,
          };
        },
      };
      return query;
    },
  }),
}));

const { withReadRequest } = await import('@/lib/data/read-request-cache');
const { readJobAssignmentOfUser, readOrganizationJob } = await import('@/lib/jobs/job-access-reads');
const getRequest = (): Request => new Request('http://localhost/auftraege', { method: 'GET' });

// One scope: the ten readers of a work pack send one read of each fact.
await withReadRequest(getRequest(), async () => {
  const jobs = await Promise.all(Array.from({ length: 10 }, () => readOrganizationJob('org', 'job')));
  const assignments = await Promise.all(
    Array.from({ length: 10 }, () => readJobAssignmentOfUser('org', 'job', 'user')),
  );
  assert.ok(jobs.every((job) => job.data?.id === 'job'));
  assert.ok(assignments.every((assignment) => assignment.data?.id === 'assignment'));
});
assert.deepEqual(queries, [
  'jobs?id=job&organization_id=org',
  'job_assignments?organization_id=org&job_id=job&user_id=user',
]);

// Every request reads again, so a removed assignment refuses the next one.
queries.length = 0;
await withReadRequest(getRequest(), () => readJobAssignmentOfUser('org', 'job', 'user'));
await withReadRequest(getRequest(), () => readJobAssignmentOfUser('org', 'job', 'user'));
assert.equal(queries.length, 2);

// Another organization, job or user is another fact.
queries.length = 0;
await withReadRequest(getRequest(), async () => {
  await readJobAssignmentOfUser('org', 'job', 'user');
  await readJobAssignmentOfUser('org', 'job', 'other-user');
  await readJobAssignmentOfUser('org', 'other-job', 'user');
  await readJobAssignmentOfUser('other-org', 'job', 'user');
});
assert.equal(queries.length, 4);

// Outside a render and a GET scope (a Server Action) each check reads fresh.
queries.length = 0;
await readJobAssignmentOfUser('org', 'job', 'user');
await readJobAssignmentOfUser('org', 'job', 'user');
assert.equal(queries.length, 2);

// A failed read stays a failure for the caller to report, and it is logged.
failing = true;
const failed = await readJobAssignmentOfUser('org', 'job', 'user');
assert.equal(failed.data, null);
assert.equal(failed.error?.code, '57014');
assert.deepEqual(logged, ['readJobAssignmentOfUser: job_assignments read failed']);
