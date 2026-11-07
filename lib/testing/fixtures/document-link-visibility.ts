// The real document readers over the in-memory database, as a field worker
// meets them: one document is linked to the worker's assigned job, that job's
// project and customer, the worker, and to records the worker cannot open
// (another job, project and customer, a colleague, a request, a service case,
// installed equipment and a maintenance coverage). The worker's job list,
// project overview and document details carry only the first group, and no
// value or id of the second. Büro and Admin read every link as before. A
// caller of another organization reaches neither the job nor the document.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

const assignedJobId = '94000000-0000-4000-8000-000000000001';
const otherJobId = '94000000-0000-4000-8000-000000000002';
const foreignJobId = '94000000-0000-4000-8000-000000000009';
const projectId = '94100000-0000-4000-8000-000000000001';
const otherProjectId = '94100000-0000-4000-8000-000000000002';
const clientId = '94200000-0000-4000-8000-000000000001';
const otherClientId = '94200000-0000-4000-8000-000000000002';
const colleagueId = '94300000-0000-4000-8000-000000000001';
const requestId = '94400000-0000-4000-8000-000000000001';
const serviceCaseId = '94500000-0000-4000-8000-000000000001';
const equipmentId = '94600000-0000-4000-8000-000000000001';
const coverageId = '94700000-0000-4000-8000-000000000001';
const documentId = '94800000-0000-4000-8000-000000000001';
const foreignDocumentId = '94800000-0000-4000-8000-000000000009';
const now = '2026-10-01T08:00:00.000Z';

/** What the field worker's own job views show. */
const fieldFacts = {
  jobTitle: 'Heizung warten',
  jobNumber: 'A-2026-230',
  projectName: 'Heizzentrale erneuern',
  projectNumber: 'P-2026-230',
  clientName: 'Feldkunde GmbH',
  ownName: 'Felix Feld',
  ownEmail: 'caller@example.test',
};
/** What belongs to records the field worker cannot open: none of it may reach them. */
const hidden = {
  otherJobTitle: 'Vertraulicher Fremdauftrag',
  otherJobNumber: 'A-2026-999',
  otherProjectName: 'Geheimprojekt Villa',
  otherProjectNumber: 'P-2026-999',
  otherClientName: 'Fremdkunde Vertraulich AG',
  colleagueName: 'Kora',
  colleagueEmail: 'kollegin@betrieb.example.test',
  requestNumber: 'ANF-0230',
  requestSummary: 'Kunde beschwert sich über Rechnung',
  serviceCaseNumber: 'SF-0230',
  serviceCaseSummary: 'Gewährleistungsstreit mit Hersteller',
  equipmentNumber: 'ANL-0230',
  equipmentName: 'Kessel im Nachbarhaus',
  coverageNumber: 'WA-0230',
  otherJobId,
  otherProjectId,
  otherClientId,
  colleagueId,
  requestId,
  serviceCaseId,
  equipmentId,
  coverageId,
};

const jobRow = (id: string, organizationId: string, number: string, title: string, job: object) => ({
  id,
  organization_id: organizationId,
  job_number: number,
  title,
  ...job,
});
const jobs = [
  jobRow(assignedJobId, ORGANIZATION_A, fieldFacts.jobNumber, fieldFacts.jobTitle, {
    project_id: projectId,
    client_id: clientId,
  }),
  jobRow(otherJobId, ORGANIZATION_A, hidden.otherJobNumber, hidden.otherJobTitle, {
    project_id: otherProjectId,
    client_id: otherClientId,
  }),
  jobRow(foreignJobId, ORGANIZATION_B, 'A-B-001', 'Auftrag der anderen Firma', {
    project_id: null,
    client_id: null,
  }),
];
const documentRow = (id: string, organizationId: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  category: 'other',
  created_at: now,
  updated_at: now,
  current_version_number: 1,
  display_name: `Schaltplan ${id.slice(-3)}.pdf`,
  original_file_name: 'schaltplan.pdf',
  size_bytes: 1024,
  storage_bucket: 'organization-documents',
  storage_path: `${organizationId}/${id}/schaltplan.pdf`,
  uploaded_by: CALLER_ID,
  copied_from_document_id: null,
  delete_reason: null,
  deleted_at: null,
  deleted_by: null,
  folder_id: null,
  metadata: {},
  mime_type: 'application/pdf',
});
const noTarget: Record<string, string | null> = {
  job_id: null,
  project_id: null,
  client_id: null,
  employee_id: null,
  request_id: null,
  equipment_id: null,
  service_case_id: null,
  maintenance_coverage_id: null,
};
const linkRow = (linkedDocumentId: string, organizationId: string, target: Record<string, string>) => ({
  id: crypto.randomUUID(),
  organization_id: organizationId,
  document_id: linkedDocumentId,
  created_at: now,
  created_by: CALLER_ID,
  ...noTarget,
  ...target,
});
const documents = [documentRow(documentId, ORGANIZATION_A), documentRow(foreignDocumentId, ORGANIZATION_B)];
const ownLinks = [
  { job_id: assignedJobId },
  { project_id: projectId },
  { client_id: clientId },
  { employee_id: CALLER_ID },
];
const otherLinks = [
  { job_id: otherJobId },
  { project_id: otherProjectId },
  { client_id: otherClientId },
  { employee_id: colleagueId },
  { request_id: requestId },
  { service_case_id: serviceCaseId },
  { equipment_id: equipmentId },
  { maintenance_coverage_id: coverageId },
];

const world = installActionWorld({
  jobs,
  job_assignments: [],
  projects: [
    {
      id: projectId,
      organization_id: ORGANIZATION_A,
      name: fieldFacts.projectName,
      project_number: fieldFacts.projectNumber,
    },
    {
      id: otherProjectId,
      organization_id: ORGANIZATION_A,
      name: hidden.otherProjectName,
      project_number: hidden.otherProjectNumber,
    },
  ],
  clients: [
    { id: clientId, organization_id: ORGANIZATION_A, name: fieldFacts.clientName },
    { id: otherClientId, organization_id: ORGANIZATION_A, name: hidden.otherClientName },
  ],
  profiles: [
    { id: CALLER_ID, first_name: 'Felix', last_name: 'Feld', email: fieldFacts.ownEmail, avatar_path: null },
    {
      id: colleagueId,
      first_name: hidden.colleagueName,
      last_name: null,
      email: hidden.colleagueEmail,
      avatar_path: null,
    },
  ],
  client_requests: [
    {
      id: requestId,
      organization_id: ORGANIZATION_A,
      request_number: hidden.requestNumber,
      summary: hidden.requestSummary,
    },
  ],
  service_cases: [
    {
      id: serviceCaseId,
      organization_id: ORGANIZATION_A,
      case_number: hidden.serviceCaseNumber,
      summary: hidden.serviceCaseSummary,
    },
  ],
  installed_equipment: [
    {
      id: equipmentId,
      organization_id: ORGANIZATION_A,
      equipment_number: hidden.equipmentNumber,
      name: hidden.equipmentName,
    },
  ],
  maintenance_coverages: [
    { id: coverageId, organization_id: ORGANIZATION_A, coverage_number: hidden.coverageNumber },
  ],
  documents,
  ordinary_documents: documents,
  personnel_documents: [],
  document_versions: [],
  document_audit_events: [],
  document_links: [
    ...[...ownLinks, ...otherLinks].map((target) => linkRow(documentId, ORGANIZATION_A, target)),
    linkRow(foreignDocumentId, ORGANIZATION_B, { job_id: foreignJobId }),
  ],
});

// The in-memory database has no joins: a job carries its assignments as an embedded array.
function assignCallerTo(jobIds: readonly string[]): void {
  world.tables.job_assignments = jobs.flatMap((job) => [
    ...(jobIds.includes(job.id)
      ? [
          {
            id: crypto.randomUUID(),
            organization_id: job.organization_id,
            job_id: job.id,
            user_id: CALLER_ID,
          },
        ]
      : []),
    { id: crypto.randomUUID(), organization_id: job.organization_id, job_id: job.id, user_id: colleagueId },
  ]);
  for (const job of world.tables.jobs ?? []) {
    job.job_assignments = (world.tables.job_assignments ?? []).filter(
      (assignment) => assignment.job_id === job.id,
    );
  }
}

const { getDocumentDetails, getJobDocuments, getProjectDocumentsOverview } = await import(
  '@/lib/documents/actions'
);

/** Every text and number below `value`, through nested objects and arrays. */
function valuesOf(value: unknown, values: string[] = []): string[] {
  if (typeof value === 'string') values.push(value);
  else if (typeof value === 'number') values.push(String(value));
  else if (typeof value === 'object' && value !== null)
    for (const child of Object.values(value)) valuesOf(child, values);
  return values;
}

type LinkView = { jobId: unknown; projectId: unknown; clientId: unknown; employeeId: unknown };
/** The one document of a successful reader result, wherever the reader puts it. */
function documentOf(result: unknown, label: string): { links: LinkView[] } {
  assert.ok(typeof result === 'object' && result !== null, `${label}: no result`);
  assert.equal(Reflect.get(result, 'success'), true, `${label}: ${JSON.stringify(result)}`);
  const single = Reflect.get(result, 'document');
  const listed = Reflect.get(result, 'documents') ?? Reflect.get(result, 'projectDocuments');
  const document = single ?? (Array.isArray(listed) ? listed.find((item) => item.id === documentId) : null);
  assert.ok(document, `${label}: the document is missing`);
  return document;
}

// The reads a field worker uses. The document details carry the version and
// audit history, which stay with Admin and Büro, so only the office reads them.
const fieldReaders = {
  jobDocuments: () => getJobDocuments(assignedJobId),
  projectOverview: () =>
    getProjectDocumentsOverview(projectId, [
      { id: assignedJobId, jobNumber: fieldFacts.jobNumber, title: fieldFacts.jobTitle },
    ]),
};
const readers = { ...fieldReaders, documentDetails: () => getDocumentDetails(documentId) };

// The assigned field worker reads the document with its own links only, and no value of another record.
signInAs(world, 'employee');
assignCallerTo([assignedJobId]);
for (const [label, read] of Object.entries(fieldReaders)) {
  const result = await read();
  const document = documentOf(result, label);
  assert.deepEqual(
    document.links.map(({ jobId, projectId, clientId, employeeId }) => [
      jobId,
      projectId,
      clientId,
      employeeId,
    ]),
    [
      [assignedJobId, null, null, null],
      [null, projectId, null, null],
      [null, null, clientId, null],
      [null, null, null, CALLER_ID],
    ],
    `${label}: the field worker reads a link outside the own work`,
  );
  const values = valuesOf(result);
  for (const fact of Object.values(fieldFacts))
    assert.ok(
      values.some((value) => value.includes(fact)),
      `${label}: the field worker misses ${fact}`,
    );
  for (const [name, secret] of Object.entries(hidden))
    assert.ok(!values.some((value) => value.includes(secret)), `${label}: the field worker receives ${name}`);
}

// The document details stay with the office: the field worker is refused.
assert.deepEqual(await getDocumentDetails(documentId), { success: false, error: 'not_authorized' });

// The project overview keeps only the assigned job's group.
const projectOverview = await fieldReaders.projectOverview();
assert.ok(projectOverview.success, JSON.stringify(projectOverview));
assert.deepEqual(
  projectOverview.jobDocumentGroups.map((group) => group.jobId),
  [assignedJobId],
);

// An assignment read that cannot complete refuses the field worker; it never shows every link.
world.failingTables.add('jobs');
for (const [label, read] of Object.entries(fieldReaders))
  assert.equal((await read()).success, false, `${label}: a failed assignment read answers the field worker`);
world.failingTables.delete('jobs');

// A field worker without the assignment reads neither the job's documents nor the document.
assignCallerTo([]);
for (const [label, read] of Object.entries(fieldReaders))
  assert.deepEqual(
    await read(),
    { success: false, error: 'not_authorized' },
    `${label}: the unassigned field worker reads the document`,
  );

// A caller of another organization reaches neither the job nor the document, whatever the role.
for (const role of ['employee', 'admin'] as const) {
  signInAs(world, role, ORGANIZATION_B);
  assignCallerTo([foreignJobId]);
  assert.deepEqual(await getJobDocuments(assignedJobId), { success: false, error: 'job_not_found' });
  assert.deepEqual(await getDocumentDetails(documentId), { success: false, error: 'document_not_found' });
}
signInAs(world, 'employee');
assignCallerTo([assignedJobId]);
assert.deepEqual(await getDocumentDetails(foreignDocumentId), {
  success: false,
  error: 'document_not_found',
});

// Büro and Admin read every link with every value, exactly as before.
assignCallerTo([]);
for (const role of ['buero', 'admin'] as const) {
  signInAs(world, role);
  for (const [label, read] of Object.entries(readers)) {
    const result = await read();
    const document = documentOf(result, `${role} ${label}`);
    assert.equal(
      document.links.length,
      ownLinks.length + otherLinks.length,
      `${role} ${label}: a link is missing`,
    );
    const values = valuesOf(result);
    for (const value of [...Object.values(fieldFacts), ...Object.values(hidden)])
      assert.ok(
        values.some((carried) => carried.includes(value)),
        `${role} ${label}: the office misses ${value}`,
      );
  }
}
