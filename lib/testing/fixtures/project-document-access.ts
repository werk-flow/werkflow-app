// The real project document reads over the in-memory database: a field worker
// assigned to a job of a project reads the project's own documents and signs
// their URLs, each job group still follows its own job assignment, and an
// unassigned field worker or a caller of another organization is refused. The
// project's own documents stay read-only for that field worker: uploading to
// the project, renaming, moving and deleting a project document need a manager,
// while the field worker's upload on the assigned job is unchanged.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

const projectId = '90000000-0000-4000-8000-000000000001';
const otherProjectId = '90000000-0000-4000-8000-000000000002';
const foreignProjectId = '90000000-0000-4000-8000-000000000009';
const assignedJobId = '91000000-0000-4000-8000-000000000001';
const unassignedJobId = '91000000-0000-4000-8000-000000000002';
const otherProjectJobId = '91000000-0000-4000-8000-000000000003';
const foreignJobId = '91000000-0000-4000-8000-000000000009';
const projectDocumentId = '92000000-0000-4000-8000-000000000001';
const assignedJobDocumentId = '92000000-0000-4000-8000-000000000002';
const unassignedJobDocumentId = '92000000-0000-4000-8000-000000000003';
const foreignProjectDocumentId = '92000000-0000-4000-8000-000000000009';
const refusedProjectUploadId = '92000000-0000-4000-8000-000000000010';
const jobUploadId = '92000000-0000-4000-8000-000000000011';
const managerProjectUploadId = '92000000-0000-4000-8000-000000000012';
const folderId = '93000000-0000-4000-8000-000000000001';
const now = '2026-10-01T08:00:00.000Z';

const projectRow = (id: string, organizationId: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  name: 'Badsanierung',
  project_number: `P-${id.slice(-3)}`,
});
const jobRow = (id: string, organizationId: string, jobProjectId: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  project_id: jobProjectId,
  title: 'Rohinstallation',
  job_number: `A-${id.slice(-3)}`,
});
const documentRow = (id: string, organizationId: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  category: 'other',
  created_at: now,
  updated_at: now,
  current_version_number: 1,
  display_name: `Plan ${id.slice(-3)}.pdf`,
  original_file_name: `plan-${id.slice(-3)}.pdf`,
  size_bytes: 1024,
  storage_bucket: 'organization-documents',
  storage_path: `${organizationId}/${id}/plan.pdf`,
  uploaded_by: CALLER_ID,
  copied_from_document_id: null,
  delete_reason: null,
  deleted_at: null,
  deleted_by: null,
  folder_id: null,
  metadata: {},
  mime_type: 'application/pdf',
});
const linkRow = (
  documentId: string,
  organizationId: string,
  target: { job_id: string } | { project_id: string },
): Record<string, unknown> => ({
  id: crypto.randomUUID(),
  organization_id: organizationId,
  document_id: documentId,
  job_id: null,
  project_id: null,
  client_id: null,
  employee_id: null,
  request_id: null,
  equipment_id: null,
  service_case_id: null,
  maintenance_coverage_id: null,
  created_at: now,
  created_by: CALLER_ID,
  ...target,
});

const jobs = [
  jobRow(assignedJobId, ORGANIZATION_A, projectId),
  jobRow(unassignedJobId, ORGANIZATION_A, projectId),
  jobRow(otherProjectJobId, ORGANIZATION_A, otherProjectId),
  jobRow(foreignJobId, ORGANIZATION_B, foreignProjectId),
];
const documents = [
  documentRow(projectDocumentId, ORGANIZATION_A),
  documentRow(assignedJobDocumentId, ORGANIZATION_A),
  documentRow(unassignedJobDocumentId, ORGANIZATION_A),
  documentRow(foreignProjectDocumentId, ORGANIZATION_B),
];
const world = installActionWorld({
  projects: [
    projectRow(projectId, ORGANIZATION_A),
    projectRow(otherProjectId, ORGANIZATION_A),
    projectRow(foreignProjectId, ORGANIZATION_B),
  ],
  jobs,
  job_assignments: [],
  documents,
  ordinary_documents: documents,
  personnel_documents: [],
  document_folders: [
    {
      id: folderId,
      organization_id: ORGANIZATION_A,
      parent_folder_id: null,
      name: 'Pläne',
      deleted_at: null,
    },
  ],
  document_audit_events: [],
  document_links: [
    linkRow(projectDocumentId, ORGANIZATION_A, { project_id: projectId }),
    linkRow(assignedJobDocumentId, ORGANIZATION_A, { job_id: assignedJobId }),
    linkRow(unassignedJobDocumentId, ORGANIZATION_A, { job_id: unassignedJobId }),
    linkRow(foreignProjectDocumentId, ORGANIZATION_B, { project_id: foreignProjectId }),
  ],
  profiles: [{ id: CALLER_ID, first_name: 'Max', last_name: 'Muster', email: 'caller@example.test' }],
});

// The in-memory database has no joins: an embedded filter column (`jobs.project_id`
// on an assignment, `job_assignments.user_id` on a job) is stored on the row itself.
function assignCallerTo(jobIds: readonly string[]): void {
  world.tables.job_assignments = jobs
    .filter((job) => jobIds.includes(String(job.id)))
    .map((job) => ({
      id: crypto.randomUUID(),
      organization_id: job.organization_id,
      job_id: job.id,
      user_id: CALLER_ID,
      'jobs.organization_id': job.organization_id,
      'jobs.project_id': job.project_id,
    }));
  for (const job of jobs) {
    job['job_assignments.user_id'] = jobIds.includes(String(job.id)) ? CALLER_ID : null;
  }
}

// The document write functions run in SQL (supabase/tests/document_writes.sql);
// here each one applies the row change it commits, so later reads see it.
world.rpc = ({ name, args }) => {
  const organizationId = String(args.p_organization_id);
  const rows = world.tables.documents ?? [];
  if (name === 'finalize_document_upload') {
    const row = {
      ...documentRow(String(args.p_document_id), organizationId),
      storage_path: args.p_storage_path,
      display_name: args.p_display_name,
      folder_id: args.p_folder_id,
    };
    rows.push(row);
    if (typeof args.p_link_kind === 'string' && typeof args.p_link_target_id === 'string') {
      const target =
        args.p_link_kind === 'job'
          ? { job_id: args.p_link_target_id }
          : { project_id: args.p_link_target_id };
      world.tables.document_links?.push(linkRow(String(args.p_document_id), organizationId, target));
    }
    return { data: structuredClone(row), error: null };
  }
  const row = rows.find(
    (document) => document.id === args.p_document_id && document.organization_id === organizationId,
  );
  if (!row) return { data: null, error: { message: 'document_not_found' } };
  if (name === 'rename_document') Object.assign(row, { display_name: args.p_display_name });
  else if (name === 'move_document')
    Object.assign(row, { folder_id: args.p_folder_id, display_name: args.p_display_name });
  else if (name === 'trash_document') Object.assign(row, { deleted_at: now, deleted_by: CALLER_ID });
  else return { data: null, error: { message: `${name} is outside this fixture` } };
  return { data: structuredClone(row), error: null };
};

const signedPaths: string[] = [];
const uploadUrlPaths: string[] = [];
const discardedPaths: string[] = [];
const outsideFixture = (name: string) => (): never => {
  throw new Error(`${name} is outside this fixture`);
};
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    signedPaths.push(path);
    return `https://storage.example.test/${path}`;
  },
  createSignedUploadUrl: async ({ path }: { path: string }) => {
    uploadUrlPaths.push(path);
    return `https://storage.example.test/upload/${path}`;
  },
  copyStorageObject: outsideFixture('copyStorageObject'),
  deleteStorageObjects: outsideFixture('deleteStorageObjects'),
  discardStorageObjects: async ({ paths }: { paths: string[] }) => {
    discardedPaths.push(...paths);
  },
  headStorageObject: async () => ({ exists: true, sizeBytes: 1024, contentType: 'application/pdf' }),
}));
const actions = await import('@/lib/documents/actions');

const overviewJobs = [
  { id: assignedJobId, jobNumber: 'A-001', title: 'Rohinstallation' },
  { id: unassignedJobId, jobNumber: 'A-002', title: 'Endmontage' },
];
const overviewOf = (id: string) => actions.getProjectDocumentsOverview(id, overviewJobs);
const notAuthorized = { success: false, error: 'not_authorized' };

// An employee assigned to one job of the project reads the project's own documents,
// and only the job group of that assigned job.
signInAs(world, 'employee');
assignCallerTo([assignedJobId]);
const assignedOverview = await overviewOf(projectId);
assert.ok(assignedOverview.success, JSON.stringify(assignedOverview));
assert.deepEqual(
  assignedOverview.projectDocuments.map((document) => document.id),
  [projectDocumentId],
);
assert.deepEqual(
  assignedOverview.jobDocumentGroups.map((group) => [group.jobId, group.documents.map(({ id }) => id)]),
  [[assignedJobId, [assignedJobDocumentId]]],
);
// The same rule signs the project document's URLs; a job document of an unassigned job stays closed.
assert.deepEqual(await actions.getDocumentSignedUrl(projectDocumentId), {
  success: true,
  signedUrl: `https://storage.example.test/${ORGANIZATION_A}/${projectDocumentId}/plan.pdf`,
});
assert.equal((await actions.getDocumentViewSignedUrl(projectDocumentId)).success, true);
assert.deepEqual(await actions.getDocumentSignedUrl(unassignedJobDocumentId), notAuthorized);
assert.equal(signedPaths.length, 2);

// An employee assigned only to a job of another project, or to nothing, is refused.
for (const assignedJobs of [[otherProjectJobId], []]) {
  assignCallerTo(assignedJobs);
  assert.deepEqual(await overviewOf(projectId), notAuthorized, `assigned to ${assignedJobs.join(',')}`);
  assert.deepEqual(await actions.getDocumentSignedUrl(projectDocumentId), notAuthorized);
  assert.deepEqual(await actions.getDocumentViewSignedUrl(projectDocumentId), notAuthorized);
}
assert.equal(signedPaths.length, 2, 'a refused caller must not receive a signed URL');

// Another organization's project and documents stay closed, even to its assigned field worker
// while the active organization is a different one, and to a manager of a different organization.
assignCallerTo([foreignJobId]);
assert.deepEqual(await overviewOf(foreignProjectId), notAuthorized);
assert.deepEqual(await actions.getDocumentSignedUrl(foreignProjectDocumentId), {
  success: false,
  error: 'document_not_found',
});
signInAs(world, 'admin');
assert.deepEqual(await overviewOf(foreignProjectId), { success: false, error: 'project_not_found' });
assert.deepEqual(await actions.getDocumentSignedUrl(foreignProjectDocumentId), {
  success: false,
  error: 'document_not_found',
});
signInAs(world, 'employee', ORGANIZATION_B);
assignCallerTo([foreignJobId]);
assert.deepEqual(await overviewOf(projectId), notAuthorized);
assert.deepEqual(await actions.getDocumentSignedUrl(projectDocumentId), {
  success: false,
  error: 'document_not_found',
});
assert.equal(signedPaths.length, 2);

// A manager keeps every job group without an assignment.
signInAs(world, 'buero');
assignCallerTo([]);
const managerOverview = await overviewOf(projectId);
assert.ok(managerOverview.success, JSON.stringify(managerOverview));
assert.deepEqual(
  managerOverview.jobDocumentGroups.map((group) => group.jobId),
  [assignedJobId, unassignedJobId],
);

// The project's own documents stay read-only for the assigned field worker: no upload
// ticket, no finalize, no rename, move or delete. A refused finalize discards the object.
const uploadFile = { fileName: 'aufmass.pdf', fileSizeBytes: 1024, mimeType: 'application/pdf' };
const linksTo = (documentId: string): Array<{ job_id: unknown; project_id: unknown }> =>
  tableRows(world, 'document_links')
    .filter((link) => link.document_id === documentId)
    .map((link) => ({ job_id: link.job_id ?? null, project_id: link.project_id ?? null }));
const projectDocumentRow = (): Record<string, unknown> | undefined =>
  tableRows(world, 'documents').find((document) => document.id === projectDocumentId);
const projectDocumentBefore = structuredClone(projectDocumentRow());
signInAs(world, 'employee');
assignCallerTo([assignedJobId]);
assert.deepEqual(
  await actions.createDocumentUploadTicket({ kind: 'project', projectId, ...uploadFile }),
  notAuthorized,
);
assert.equal(uploadUrlPaths.length, 0, 'a refused project upload must not receive a signed upload URL');
assert.deepEqual(
  await actions.finalizeDocumentUpload({
    kind: 'project',
    projectId,
    documentId: refusedProjectUploadId,
    fileName: 'aufmass.pdf',
  }),
  notAuthorized,
);
assert.deepEqual(discardedPaths, [`${ORGANIZATION_A}/${refusedProjectUploadId}/aufmass.pdf`]);
assert.equal(
  tableRows(world, 'documents').some((document) => document.id === refusedProjectUploadId),
  false,
);
assert.deepEqual(
  await actions.renameDocument({ documentId: projectDocumentId, displayName: 'Umbenannt.pdf' }),
  notAuthorized,
);
assert.deepEqual(await actions.moveDocument({ documentId: projectDocumentId, folderId }), notAuthorized);
assert.deepEqual(await actions.deleteDocument(projectDocumentId), notAuthorized);
assert.deepEqual(projectDocumentRow(), projectDocumentBefore);

// The same field worker still uploads on the assigned job, from ticket to finalized link.
const jobTicket = await actions.createDocumentUploadTicket({
  kind: 'job',
  jobId: assignedJobId,
  ...uploadFile,
});
assert.ok(jobTicket.success, JSON.stringify(jobTicket));
const jobUpload = await actions.finalizeDocumentUpload({
  kind: 'job',
  jobId: assignedJobId,
  documentId: jobUploadId,
  fileName: 'aufmass.pdf',
});
assert.ok(jobUpload.success, JSON.stringify(jobUpload));
assert.deepEqual(linksTo(jobUploadId), [{ job_id: assignedJobId, project_id: null }]);
assert.deepEqual(
  await actions.createDocumentUploadTicket({ kind: 'job', jobId: unassignedJobId, ...uploadFile }),
  notAuthorized,
);

// A manager uploads to the project and renames, moves and deletes its documents.
signInAs(world, 'buero');
assignCallerTo([]);
const managerTicket = await actions.createDocumentUploadTicket({ kind: 'project', projectId, ...uploadFile });
assert.ok(managerTicket.success, JSON.stringify(managerTicket));
const managerUpload = await actions.finalizeDocumentUpload({
  kind: 'project',
  projectId,
  documentId: managerProjectUploadId,
  fileName: 'aufmass.pdf',
});
assert.ok(managerUpload.success, JSON.stringify(managerUpload));
assert.deepEqual(linksTo(managerProjectUploadId), [{ job_id: null, project_id: projectId }]);
const renamed = await actions.renameDocument({ documentId: projectDocumentId, displayName: 'Umbenannt.pdf' });
assert.ok(renamed.success, JSON.stringify(renamed));
const moved = await actions.moveDocument({ documentId: projectDocumentId, folderId });
assert.ok(moved.success, JSON.stringify(moved));
assert.deepEqual(await actions.deleteDocument(projectDocumentId), { success: true });
assert.equal(typeof projectDocumentRow()?.deleted_at, 'string');
