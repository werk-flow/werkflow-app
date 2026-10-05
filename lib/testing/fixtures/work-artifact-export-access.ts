// The real artifact export over the in-memory database: the export stores the
// object and calls export_work_artifact, which writes the document, its link
// to the artifact's target and the export action in one transaction
// (supabase/tests/document_writes.sql). A field worker assigned to a job of a
// project reads the project's artifacts, but an export of a project artifact
// is a project-level document write and needs a manager. The same field worker
// still exports an artifact of the assigned job. An artifact of another
// organization is not found and nothing is stored.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const projectId = '90000000-0000-4000-8000-000000000001';
const jobId = '91000000-0000-4000-8000-000000000001';
const projectArtifactId = '94000000-0000-4000-8000-000000000001';
const jobArtifactId = '94000000-0000-4000-8000-000000000002';
const foreignArtifactId = '94000000-0000-4000-8000-000000000003';
const now = '2026-10-01T08:00:00.000Z';

const artifactRow = (id: string, target: { job_id: string } | { project_id: string }) => ({
  id,
  organization_id: ORGANIZATION_A,
  job_id: null,
  project_id: null,
  kind: 'measurement',
  status: 'approved',
  version: 3,
  current_revision_id: `${id.slice(0, -1)}9`,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
  ...target,
});
const revisionRow = (artifactId: string) => ({
  id: `${artifactId.slice(0, -1)}9`,
  organization_id: ORGANIZATION_A,
  artifact_id: artifactId,
  revision_number: 1,
  kind: 'measurement',
  title: 'Aufmaß Heizraum',
  visibility: 'customer_facing',
  corrects_revision_id: null,
  captured_at: now,
  created_at: now,
  created_by: CALLER_ID,
  measurement_date: '2026-10-01',
  measurement_location: 'Keller',
});

const world = installActionWorld({
  projects: [
    { id: projectId, organization_id: ORGANIZATION_A, name: 'Badsanierung', project_number: 'P-001' },
  ],
  // The in-memory database has no joins: the embedded assignment filter is stored on the job row.
  jobs: [
    {
      id: jobId,
      organization_id: ORGANIZATION_A,
      project_id: projectId,
      'job_assignments.user_id': CALLER_ID,
    },
  ],
  job_assignments: [
    { id: crypto.randomUUID(), organization_id: ORGANIZATION_A, job_id: jobId, user_id: CALLER_ID },
  ],
  work_artifacts: [
    artifactRow(projectArtifactId, { project_id: projectId }),
    artifactRow(jobArtifactId, { job_id: jobId }),
    { ...artifactRow(foreignArtifactId, { job_id: jobId }), organization_id: ORGANIZATION_B },
  ],
  work_artifact_revisions: [revisionRow(projectArtifactId), revisionRow(jobArtifactId)],
  work_artifact_actions: [],
  work_artifact_measurement_lines: [],
  work_artifact_defect_details: [],
  work_artifact_change_details: [],
  work_artifact_revision_documents: [],
  work_artifact_revision_sources: [],
  documents: [],
  document_links: [],
  document_audit_events: [],
});
world.rpc = ({ name, args }) =>
  name === 'export_work_artifact'
    ? {
        data: { version: 5, status: 'approved', documentId: args.p_document_id, duplicate: false },
        error: null,
      }
    : { data: null, error: { message: `${name} is outside this fixture` } };

const storedPaths: string[] = [];
mock.module('@/lib/storage/r2', () => ({
  putStorageObject: async ({ path }: { path: string }) => {
    storedPaths.push(path);
  },
  discardStorageObjects: async () => {},
}));
const { exportWorkArtifact } = await import('@/lib/work-artifacts/actions');

const exportOf = (artifactId: string, documentId: string) =>
  exportWorkArtifact({
    artifactId,
    expectedVersion: 3,
    linkId: crypto.randomUUID(),
    actionId: crypto.randomUUID(),
    documentId,
  });
const exportCalls = () =>
  world.rpcCalls.map(({ name, args }) => ({
    name,
    organization: args.p_organization_id,
    artifact: args.p_artifact_id,
    document: args.p_document_id,
  }));

// The assigned field worker cannot export the project artifact: no stored object, no database write.
signInAs(world, 'employee');
const refusedDocumentId = crypto.randomUUID();
assert.deepEqual(await exportOf(projectArtifactId, refusedDocumentId), {
  success: false,
  error: 'not_authorized',
});
assert.deepEqual(storedPaths, []);
assert.deepEqual(world.rpcCalls, []);

// Another organization's artifact id is not found, for a field worker and for a manager.
for (const role of ['employee', 'buero'] as const) {
  signInAs(world, role);
  const foreignExport = await exportOf(foreignArtifactId, crypto.randomUUID());
  assert.equal(foreignExport.success, false, role);
  assert.deepEqual(storedPaths, []);
  assert.deepEqual(world.rpcCalls, []);
}

// The same field worker exports the assigned job's artifact in one call.
signInAs(world, 'employee');
const jobDocumentId = crypto.randomUUID();
const jobExport = await exportOf(jobArtifactId, jobDocumentId);
assert.ok(jobExport.success, JSON.stringify(jobExport));
assert.equal(jobExport.documentId, jobDocumentId);

// A manager exports the project artifact into a project document.
signInAs(world, 'buero');
const projectDocumentId = crypto.randomUUID();
const projectExport = await exportOf(projectArtifactId, projectDocumentId);
assert.ok(projectExport.success, JSON.stringify(projectExport));
assert.deepEqual(exportCalls(), [
  {
    name: 'export_work_artifact',
    organization: ORGANIZATION_A,
    artifact: jobArtifactId,
    document: jobDocumentId,
  },
  {
    name: 'export_work_artifact',
    organization: ORGANIZATION_A,
    artifact: projectArtifactId,
    document: projectDocumentId,
  },
]);
assert.equal(storedPaths.length, 2);
