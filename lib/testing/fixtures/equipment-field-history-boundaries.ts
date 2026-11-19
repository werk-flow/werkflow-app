// The work pack's history and documents of one Anlage over the in-memory
// database (werk-flow/werkflow-planning#468). The employee assigned to the job
// reads the customer-safe history of the job's Anlage and its Vorgänger, paged
// newest first, and opens its ordinary manual; nothing internal or financial
// reaches them. An employee not assigned to the job, an Anlage not linked to
// the job, and a job or Anlage of another organization read nothing.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import {
  ORGANIZATION_A,
  ORGANIZATION_B,
  CALLER_ID,
  installActionWorld,
  listProfileReferencesInWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const id = (n: number) => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ownJobId = id(1);
const otherJobId = id(2);
const foreignJobId = id(3);
const equipmentId = id(10);
const predecessorId = id(11);
const unlinkedEquipmentId = id(12);
const foreignEquipmentId = id(13);
const correctedSuccessorId = id(14);
const revisionId = id(20);
const predecessorRevisionId = id(21);
const customerRevisionId = id(30);
const internalRevisionId = id(31);
const manualId = id(40);
const contractId = id(41);
const coverageManualId = id(42);

const equipment = (rowId: string, organizationId: string, number: string, predecessor: string | null) => ({
  id: rowId,
  organization_id: organizationId,
  equipment_number: number,
  name: `Gasbrennwertkessel ${number}`,
  predecessor_equipment_id: predecessor,
  voided_at: null,
});
const dueWork = (rowId: string, revision: string, completedOn: string | null, outcome: string | null) => ({
  id: rowId,
  organization_id: ORGANIZATION_A,
  maintenance_plan_revision_id: revision,
  status: completedOn ? 'completed' : 'open',
  completed_on: completedOn,
  scope_outcome: outcome,
});
const document = (rowId: string, name: string, category: string) => ({
  id: rowId,
  organization_id: ORGANIZATION_A,
  folder_id: null,
  storage_path: `${ORGANIZATION_A}/${rowId}/${name}`,
  display_name: name,
  original_file_name: name,
  category,
  mime_type: 'application/pdf',
  current_version_number: 1,
  uploaded_by: CALLER_ID,
  retention_class: null,
  deleted_at: null,
});
// A link names one target; the other target columns are null, as in the table.
const documentLink = (rowId: string, documentId: string, target: Record<string, string>) => ({
  id: rowId,
  organization_id: ORGANIZATION_A,
  document_id: documentId,
  job_id: null,
  project_id: null,
  client_id: null,
  employee_id: null,
  request_id: null,
  equipment_id: null,
  service_case_id: null,
  maintenance_coverage_id: null,
  ...target,
});
// Eleven older visits of the Anlage push the history past one page.
const olderVisits = Array.from({ length: 11 }, (_, index) =>
  dueWork(id(100 + index), revisionId, `2024-${String(index + 1).padStart(2, '0')}-15`, 'complete'),
);

const world = installActionWorld({
  jobs: [
    { id: ownJobId, organization_id: ORGANIZATION_A, project_id: null },
    { id: otherJobId, organization_id: ORGANIZATION_A, project_id: null },
    { id: foreignJobId, organization_id: ORGANIZATION_B, project_id: null },
  ],
  job_assignments: [{ id: id(5), organization_id: ORGANIZATION_A, job_id: ownJobId, user_id: CALLER_ID }],
  installed_equipment: [
    equipment(equipmentId, ORGANIZATION_A, 'ANL-2', predecessorId),
    equipment(predecessorId, ORGANIZATION_A, 'ANL-1', null),
    equipment(unlinkedEquipmentId, ORGANIZATION_A, 'ANL-3', null),
    equipment(foreignEquipmentId, ORGANIZATION_B, 'ANL-9', null),
    // The job's Anlage was itself replaced later; its Nachfolger is no Vorgänger.
    equipment(correctedSuccessorId, ORGANIZATION_A, 'ANL-4', equipmentId),
  ],
  installed_equipment_work_links: [
    { id: id(6), organization_id: ORGANIZATION_A, job_id: ownJobId, equipment_id: equipmentId },
    { id: id(7), organization_id: ORGANIZATION_A, job_id: otherJobId, equipment_id: unlinkedEquipmentId },
    { id: id(8), organization_id: ORGANIZATION_B, job_id: foreignJobId, equipment_id: foreignEquipmentId },
  ],
  installed_equipment_events: [
    {
      id: id(50),
      organization_id: ORGANIZATION_A,
      equipment_id: predecessorId,
      event_type: 'replaced',
      effective_at: '2026-03-15T23:30:00.000Z',
      corrects_event_id: null,
      reason: 'Interner Austauschgrund',
    },
    {
      id: id(51),
      organization_id: ORGANIZATION_A,
      equipment_id: equipmentId,
      event_type: 'replaced',
      effective_at: '2023-06-01T08:00:00.000Z',
      corrects_event_id: null,
      reason: null,
    },
  ],
  maintenance_plan_revision_equipment: [
    {
      id: id(60),
      organization_id: ORGANIZATION_A,
      maintenance_plan_revision_id: revisionId,
      equipment_id: equipmentId,
    },
    {
      id: id(61),
      organization_id: ORGANIZATION_A,
      maintenance_plan_revision_id: predecessorRevisionId,
      equipment_id: predecessorId,
    },
  ],
  maintenance_due_work: [
    dueWork(id(70), revisionId, '2026-10-01', 'partial'),
    dueWork(id(71), predecessorRevisionId, '2025-10-01', 'complete'),
    dueWork(id(72), revisionId, null, null),
    ...olderVisits,
  ],
  maintenance_due_evidence_links: [
    {
      id: id(80),
      organization_id: ORGANIZATION_A,
      maintenance_due_work_id: id(70),
      work_artifact_revision_id: customerRevisionId,
    },
    {
      id: id(81),
      organization_id: ORGANIZATION_A,
      maintenance_due_work_id: id(70),
      work_artifact_revision_id: internalRevisionId,
    },
  ],
  work_artifact_revisions: [
    {
      id: customerRevisionId,
      organization_id: ORGANIZATION_A,
      artifact_id: id(90),
      visibility: 'customer_facing',
    },
    {
      id: internalRevisionId,
      organization_id: ORGANIZATION_A,
      artifact_id: id(91),
      visibility: 'internal_only',
    },
  ],
  work_artifacts: [
    { id: id(90), organization_id: ORGANIZATION_A, voided_at: null },
    { id: id(91), organization_id: ORGANIZATION_A, voided_at: null },
  ],
  work_artifact_defect_details: [
    {
      organization_id: ORGANIZATION_A,
      revision_id: customerRevisionId,
      description: 'Abgasrohr undicht',
      location: 'Heizraum',
      severity: 'high',
      state: 'open',
      responsibility_context: 'Interne Zuständigkeit',
    },
    {
      organization_id: ORGANIZATION_A,
      revision_id: internalRevisionId,
      description: 'Interne Notiz',
      location: 'Büro',
      severity: 'low',
      state: 'open',
    },
  ],
  work_artifact_measurement_lines: [
    {
      id: id(95),
      organization_id: ORGANIZATION_A,
      revision_id: customerRevisionId,
      line_number: 1,
      description: 'Abgasverlust',
      quantity: 6,
      unit: 'piece',
      location: null,
      note: 'Interne Anmerkung',
    },
  ],
  documents: [
    { ...document(manualId, 'Bedienungsanleitung.pdf', 'other'), metadata: { notiz: 'Intern' } },
    document(contractId, 'Wartungsvertrag.pdf', 'contract'),
    document(coverageManualId, 'Vertragsanlage.pdf', 'other'),
  ],
  document_links: [
    documentLink(id(45), manualId, { equipment_id: equipmentId }),
    documentLink(id(46), contractId, { equipment_id: equipmentId }),
    documentLink(id(47), coverageManualId, { equipment_id: equipmentId }),
    documentLink(id(48), coverageManualId, { maintenance_coverage_id: id(49) }),
  ],
  organization_members: [{ organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' }],
  personnel_documents: [],
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Erika',
      last_name: 'Musterfrau',
      email: 'erika@example.test',
      avatar_path: null,
    },
  ],
});
// Storage stands in; only the manual's view URL is ever signed.
const unreachedStorage = () => {
  throw new Error('storage is outside this fixture');
};
// The uploader's name resolves as in the database, so the projection must drop it.
world.rpc = ({ name, args }) =>
  name === 'list_profile_references'
    ? listProfileReferencesInWorld(world, args)
    : { data: null, error: null };
mock.module('@/lib/storage/r2', () => ({
  copyStorageObject: unreachedStorage,
  createSignedDownloadUrl: async () => 'https://storage.example.test/download',
  createSignedUploadUrl: unreachedStorage,
  discardStorageObjects: unreachedStorage,
  promoteUploadedObject: unreachedStorage,
  uploadStagingPath: (path: string) => `staging/${path}`,
}));
const { getFieldEquipmentHistory, getFieldEquipmentDocuments } = await import(
  '@/lib/installed-equipment/field-history-reads'
);
const { getDocumentViewSignedUrl } = await import('@/lib/documents/actions');

const history = (jobId: string, anlageId: string, before: string | null = null) =>
  getFieldEquipmentHistory({ jobId, equipmentId: anlageId, before });
const documents = (jobId: string, anlageId: string) =>
  getFieldEquipmentDocuments({ jobId, equipmentId: anlageId });

// The assigned employee reads the history newest first, ten per page.
signInAs(world, 'employee');
const first = await history(ownJobId, equipmentId);
assert.ok(first.success, `the assigned employee's history failed: ${JSON.stringify(first)}`);
assert.equal(first.page.entries.length, 10, 'a page holds ten entries');
assert.ok(first.page.nextCursor, 'a longer history offers the next page');
const [latestVisit, replacement, predecessorVisit] = first.page.entries;
assert.deepEqual(latestVisit, {
  kind: 'visit',
  key: `visit:${id(70)}`,
  date: '2026-10-01',
  outcome: 'partial',
  equipment: { equipmentNumber: 'ANL-2', name: 'Gasbrennwertkessel ANL-2', isPredecessor: false },
  defects: [{ description: 'Abgasrohr undicht', location: 'Heizraum', severity: 'high', state: 'open' }],
  measurements: [{ description: 'Abgasverlust', quantity: 6, unit: 'piece', location: null }],
});
// The replacement takes effect on its Berlin day and names both devices, never its reason.
assert.deepEqual(replacement, {
  kind: 'replacement',
  key: `replacement:${id(50)}`,
  date: '2026-03-16',
  predecessor: { equipmentNumber: 'ANL-1', name: 'Gasbrennwertkessel ANL-1', isPredecessor: true },
  successor: { equipmentNumber: 'ANL-2', name: 'Gasbrennwertkessel ANL-2', isPredecessor: false },
});
assert.equal(predecessorVisit?.kind === 'visit' && predecessorVisit.equipment.isPredecessor, true);
const second = await history(ownJobId, equipmentId, first.page.nextCursor);
assert.ok(second.success);
assert.equal(second.page.nextCursor, null, 'the last page offers no next page');
const keys = [...first.page.entries, ...second.page.entries].map((entry) => entry.key);
assert.equal(new Set(keys).size, 15, 'the pages hold every completed visit and both replacements once');
const ownReplacement = second.page.entries.find((entry) => entry.key === `replacement:${id(51)}`);
assert.deepEqual(
  ownReplacement?.kind === 'replacement' && ownReplacement.successor,
  { equipmentNumber: 'ANL-4', name: 'Gasbrennwertkessel ANL-4', isPredecessor: false },
  "the Nachfolger of the job's Anlage is no Vorgänger",
);
assert.ok(!keys.includes(`visit:${id(72)}`), 'an open due item is no visit');
const serialized = JSON.stringify([first, second]);
for (const internal of [
  'Interne Notiz',
  'Interne Zuständigkeit',
  'Interne Anmerkung',
  'Interner Austauschgrund',
]) {
  assert.ok(!serialized.includes(internal), `the history leaks "${internal}"`);
}

// Only the ordinary manual opens; a financial paper and an office-only document stay closed.
const shown = await documents(ownJobId, equipmentId);
assert.ok(shown.success, `the assigned employee's documents failed: ${JSON.stringify(shown)}`);
assert.deepEqual(
  shown.documents.map((row) => row.displayName),
  ['Bedienungsanleitung.pdf'],
);
assert.deepEqual(
  shown.documents.map(({ uploader, metadata }) => ({ uploader, metadata })),
  [{ uploader: null, metadata: {} }],
  'a field document names no uploader and carries no free-form metadata',
);
assert.deepEqual(await getDocumentViewSignedUrl(manualId), {
  success: true,
  signedUrl: 'https://storage.example.test/download',
});
await assertRefused(
  world,
  [
    ['getDocumentViewSignedUrl contract', () => getDocumentViewSignedUrl(contractId)],
    ['getDocumentViewSignedUrl coverage document', () => getDocumentViewSignedUrl(coverageManualId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);

// An Anlage not linked to the job, and a foreign job or Anlage, read nothing.
const refusedReads = [
  ['history of an unlinked Anlage', () => history(ownJobId, unlinkedEquipmentId)],
  ['history of a foreign Anlage', () => history(ownJobId, foreignEquipmentId)],
  ['history on a foreign job', () => history(foreignJobId, foreignEquipmentId)],
  ['documents of an unlinked Anlage', () => documents(ownJobId, unlinkedEquipmentId)],
  ['documents on a foreign job', () => documents(foreignJobId, foreignEquipmentId)],
] as const;
await assertRefused(world, refusedReads, { success: false, error: 'not_authorized' }, 'reads');
signInAs(world, 'buero');
await assertRefused(world, refusedReads, { success: false, error: 'not_authorized' }, 'reads');

// Once the assignment ends, the employee reads nothing of the Anlage, nor opens its manual.
signInAs(world, 'employee');
world.tables.job_assignments = [];
await assertRefused(
  world,
  [
    ['history after the assignment ended', () => history(ownJobId, equipmentId)],
    ['documents after the assignment ended', () => documents(ownJobId, equipmentId)],
    ['manual after the assignment ended', () => getDocumentViewSignedUrl(manualId)],
  ],
  { success: false, error: 'not_authorized' },
  'reads',
);
