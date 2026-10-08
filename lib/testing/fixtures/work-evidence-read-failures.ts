// The real work-evidence and time-correction actions over the in-memory
// database, with one table whose reads fail as a dropped connection would.
// A failed pre-check read is a load failure the caller shows, never „nicht
// gefunden“, never a refusal and never a skipped check; once the read succeeds,
// a missing row keeps its own not-found or refusal code.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import { createInMemoryAdmin } from './in-memory-admin';

const jobId = '91000000-0000-4000-8000-000000000001';
const artifactId = '94000000-0000-4000-8000-000000000001';
const signatureId = '95000000-0000-4000-8000-000000000001';
const requestId = '96000000-0000-4000-8000-000000000001';
const subjectId = '30000000-0000-4000-8000-000000000002';
const missingId = '99000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';

const world = installActionWorld({
  jobs: [{ id: jobId, organization_id: ORGANIZATION_A, project_id: null }],
  job_assignments: [],
  work_artifacts: [
    {
      id: artifactId,
      organization_id: ORGANIZATION_A,
      job_id: jobId,
      project_id: null,
      status: 'approved',
      version: 1,
      current_revision_id: null,
      created_at: now,
      updated_at: now,
    },
  ],
  work_artifact_revision_documents: [],
  documents: [
    {
      id: signatureId,
      organization_id: ORGANIZATION_A,
      storage_path: `${ORGANIZATION_A}/signatures/${signatureId}.png`,
      uploaded_by: CALLER_ID,
      category: 'photo',
    },
  ],
  time_correction_requests: [
    { id: requestId, organization_id: ORGANIZATION_A, subject_user_id: subjectId, current_revision: 1 },
  ],
  organization_members: [],
});

/** A table whose reads fail; every other table reads the in-memory rows. */
let failingReadTable: string | null = null;
const rpcCalls: string[] = [];
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => {
    const admin = createInMemoryAdmin(world.tables);
    return {
      from: (table: string) => {
        const query = admin.from(table);
        if (table === failingReadTable) {
          query.then = (onFulfilled, onRejected) =>
            Promise.resolve({
              data: null,
              error: { code: '08006', message: 'read failed' },
              count: null,
            }).then(onFulfilled, onRejected);
        }
        return query;
      },
      rpc: async (name: string) => {
        rpcCalls.push(name);
        return { data: null, error: { message: `${name} is outside this fixture` } };
      },
    };
  },
}));
const discardedPaths: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  putStorageObject: async () => {},
  discardStorageObjects: async ({ paths }: { paths: string[] }) => {
    discardedPaths.push(...paths);
  },
}));
const { discardUnlinkedWorkArtifactSignature, getWorkArtifactDetail, getWorkArtifacts } = await import(
  '@/lib/work-artifacts/actions'
);
const { reviewTimeCorrection } = await import('@/lib/time-corrections/actions');

const loadFailed = { success: false, error: 'load_failed' };

// The artifact read: a failure is the detail's load failure, a missing row is not found.
signInAs(world, 'admin');
failingReadTable = 'work_artifacts';
assert.deepEqual(await getWorkArtifactDetail(artifactId), {
  success: false,
  error: 'work_artifact_load_failed',
});
failingReadTable = null;
assert.deepEqual(await getWorkArtifactDetail(missingId), {
  success: false,
  error: 'work_artifact_not_found',
});

// The target check of a field worker: a failed job or assignment read is a load
// failure, never "keine Berechtigung"; no assignment stays a refusal.
signInAs(world, 'employee');
const jobTarget = { targetType: 'job' as const, targetId: jobId };
for (const table of ['jobs', 'job_assignments']) {
  failingReadTable = table;
  assert.deepEqual(await getWorkArtifacts(jobTarget), loadFailed, table);
}
failingReadTable = null;
assert.deepEqual(await getWorkArtifacts(jobTarget), { success: false, error: 'not_authorized' });

// An unread signature relation could be a signature in use: nothing is deleted.
failingReadTable = 'work_artifact_revision_documents';
assert.deepEqual(await discardUnlinkedWorkArtifactSignature(signatureId), loadFailed);
failingReadTable = null;
assert.deepEqual(
  tableRows(world, 'documents').map((row) => row.id),
  [signatureId],
);
assert.deepEqual(discardedPaths, []);

// The correction review: a failed request or subject read is a load failure;
// a missing request or subject keeps its own code. No decision is written.
signInAs(world, 'admin');
const review = (id: string) =>
  reviewTimeCorrection({
    requestId: id,
    expectedRevision: 1,
    decision: 'approve',
    comment: null,
    operationId: crypto.randomUUID(),
  });
for (const table of ['time_correction_requests', 'organization_members']) {
  failingReadTable = table;
  assert.deepEqual(await review(requestId), loadFailed, table);
}
failingReadTable = null;
assert.deepEqual(await review(missingId), { success: false, error: 'request_not_found' });
assert.deepEqual(await review(requestId), { success: false, error: 'subject_not_found' });
assert.deepEqual(rpcCalls, []);
