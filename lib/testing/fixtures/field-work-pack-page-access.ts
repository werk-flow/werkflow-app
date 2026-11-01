// The real job pages over the in-memory database, as the field worker meets
// them: an assigned field worker opens the field work pack of a standalone job
// and of a project job, and no rendered value carries an internal note, an
// e-mail address, a colleague's draft, a sibling job, a serial number, a
// warranty, a price, a billable quantity or the maintenance contract. A field
// worker who is not assigned, and a member of another organization, get no
// pack, and the pack readers refuse them or find nothing of this organization. Büro and Admin of the owning
// organization open the same jobs in the office view with these values, so
// each absence answers the role, not a missing row.
import assert from 'node:assert/strict';
import { isValidElement, type ReactElement } from 'react';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, refusal, renderTree, type Render } from './page-render';

const clientId = '6c000000-0000-4000-8000-000000000001';
const siteId = '6c000000-0000-4000-8000-000000000002';
const contactId = '6c000000-0000-4000-8000-000000000003';
const projectId = '6c000000-0000-4000-8000-000000000004';
const jobId = '6c000000-0000-4000-8000-000000000005';
const childJobId = '6c000000-0000-4000-8000-000000000006';
const siblingJobId = '6c000000-0000-4000-8000-000000000007';
const unassignedJobId = '6c000000-0000-4000-8000-000000000008';
const colleagueId = '6c000000-0000-4000-8000-000000000009';
const equipmentId = '6c000000-0000-4000-8000-00000000000a';
const coverageId = '6c000000-0000-4000-8000-00000000000b';
const planId = '6c000000-0000-4000-8000-00000000000c';
const revisionId = '6c000000-0000-4000-8000-00000000000d';
const templateVersionId = '6c000000-0000-4000-8000-00000000000e';
const itemId = '6c000000-0000-4000-8000-00000000000f';
const draftId = '6c000000-0000-4000-8000-000000000010';
const draftRevisionId = '6c000000-0000-4000-8000-000000000011';
const projectNumber = 'P-2026-116';
const jobNumber = 'A-2026-116';
const childJobNumber = 'P-2026-116-1';
const siblingJobNumber = 'P-2026-116-2';
const unassignedJobNumber = 'A-2026-117';
const now = '2026-10-01T08:00:00.000Z';

/** What the field worker needs on site. */
const fieldFacts = {
  customer: 'Feldkunde GmbH',
  site: 'Heizzentrale Nord',
  accessNotes: 'Schlüssel an der Pforte abholen.',
  contact: 'Kim Objektleitung',
  outcome: 'Störung prüfen und Ergebnis dokumentieren.',
  equipment: 'Wärmepumpe Nord',
  plan: 'WP-0020',
  instructions: 'Messwerte vollständig erfassen.',
};
/** What only the office reads: none of it may reach the field worker's pack. */
const officeOnly = {
  clientEmail: 'buchhaltung@kunde.example.test',
  clientNotes: 'Interne Kundenbewertung für die Geschäftsleitung.',
  customerNumber: 'K-INTERN-0116',
  siteNotes: 'Interne Standortbewertung für die Einsatzleitung.',
  contactEmail: 'office-only@kunde.example.test',
  contactNotes: 'Interne Kontaktnotiz für das Büro.',
  colleagueEmail: 'kollegin@betrieb.example.test',
  siblingTitle: 'Vertraulicher Geschwisterauftrag',
  draftTitle: 'Interner Büroentwurf',
  serialNumber: 'SER-GEHEIM-0118',
  warrantyProvider: 'Garantiegeber Intern AG',
  technicalNotes: 'Interne Technikbewertung.',
  coverageReference: 'VERTRAG-GEHEIM-0120',
  coverageNote: 'Leistungsumfang vor Verlängerung prüfen.',
  purchasePriceCents: 987_654,
  salePriceCents: 1_234_567,
  billableQuantity: 4321,
};

const jobRow = (id: string, number: string, title: string, jobProjectId: string | null) => ({
  id,
  organization_id: ORGANIZATION_A,
  project_id: jobProjectId,
  client_id: clientId,
  site_id: siteId,
  contact_id: contactId,
  job_number: number,
  title,
  description: fieldFacts.outcome,
  status: 'nicht_bearbeitet',
  execution_state: 'not_started',
  execution_version: 0,
  priority: 'mittel',
  planned_date: '2026-10-02',
  planned_time: null,
  location: null,
  created_by: colleagueId,
  created_at: now,
  updated_at: now,
});
const assignment = (id: string, assignedJobId: string, userId: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  job_id: assignedJobId,
  user_id: userId,
  assigned_by: colleagueId,
  assigned_at: now,
});
const materialLine = (id: string, lineJobId: string) => ({
  id,
  organization_id: ORGANIZATION_A,
  job_id: lineJobId,
  project_id: null,
  item_id: itemId,
  planned_quantity: 2,
  taken_quantity: 0,
  returned_quantity: 0,
  billable_quantity: officeOnly.billableQuantity,
  is_billable: true,
  is_unplanned: false,
  status: 'planned',
  notes: null,
  preferred_location_id: null,
  source_work_template_material_line_id: null,
  work_template_application_id: null,
  created_by: colleagueId,
  created_at: now,
  updated_at: now,
});

const world = await installPageWorld({
  clients: [
    {
      id: clientId,
      organization_id: ORGANIZATION_A,
      name: fieldFacts.customer,
      client_type: 'gewerblich',
      customer_number: officeOnly.customerNumber,
      email: officeOnly.clientEmail,
      phone: '+49 30 5550116',
      address: null,
      notes: officeOnly.clientNotes,
      created_at: now,
      updated_at: now,
    },
  ],
  client_sites: [
    {
      id: siteId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: fieldFacts.site,
      street: 'Feldstraße 16',
      postal_code: '10115',
      city: 'Berlin',
      access_notes: fieldFacts.accessNotes,
      notes: officeOnly.siteNotes,
      primary_contact_id: contactId,
      is_primary: true,
      is_active: true,
      created_by: colleagueId,
      created_at: now,
      updated_at: now,
    },
  ],
  client_contacts: [
    {
      id: contactId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      name: fieldFacts.contact,
      role: 'Objektleitung',
      email: officeOnly.contactEmail,
      phone: '+49 30 5550160',
      notes: officeOnly.contactNotes,
      is_primary: true,
      is_active: true,
      created_by: colleagueId,
      created_at: now,
      updated_at: now,
    },
  ],
  projects: [
    {
      id: projectId,
      organization_id: ORGANIZATION_A,
      project_number: projectNumber,
      name: 'Heizzentrale erneuern',
      description: null,
      client_id: clientId,
      site_id: siteId,
      contact_id: contactId,
      created_by: colleagueId,
      created_at: now,
      updated_at: now,
    },
  ],
  jobs: [
    jobRow(jobId, jobNumber, 'Wartung Wärmepumpe', null),
    jobRow(childJobId, childJobNumber, 'Kindauftrag prüfen', projectId),
    jobRow(siblingJobId, siblingJobNumber, officeOnly.siblingTitle, projectId),
    jobRow(unassignedJobId, unassignedJobNumber, 'Nicht zugewiesen', null),
  ],
  job_assignments: [
    assignment('6c000000-0000-4000-8000-000000000021', jobId, CALLER_ID),
    assignment('6c000000-0000-4000-8000-000000000022', jobId, colleagueId),
    assignment('6c000000-0000-4000-8000-000000000023', childJobId, CALLER_ID),
    assignment('6c000000-0000-4000-8000-000000000024', siblingJobId, colleagueId),
    assignment('6c000000-0000-4000-8000-000000000025', unassignedJobId, colleagueId),
  ],
  profiles: [
    {
      id: CALLER_ID,
      first_name: 'Felix',
      last_name: 'Feld',
      email: 'caller@example.test',
      avatar_path: null,
    },
    {
      id: colleagueId,
      first_name: 'Kora',
      last_name: 'Kollegin',
      email: officeOnly.colleagueEmail,
      avatar_path: null,
    },
  ],
  installed_equipment: [
    {
      id: equipmentId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      site_id: siteId,
      equipment_number: 'ANL-0118',
      name: fieldFacts.equipment,
      category: 'heat_generator',
      subtype: null,
      state: 'active',
      manufacturer: 'WerkFlow Testtechnik',
      model: 'WP 18',
      location_detail: 'Keller',
      warranty_provider: officeOnly.warrantyProvider,
      warranty_basis: null,
      warranty_start_date: null,
      warranty_end_date: '2030-01-01',
      technical_notes: officeOnly.technicalNotes,
      voided_at: null,
    },
  ],
  installed_equipment_identifiers: [
    {
      id: '6c000000-0000-4000-8000-000000000032',
      organization_id: ORGANIZATION_A,
      equipment_id: equipmentId,
      identifier_type: 'serial_number',
      value: officeOnly.serialNumber,
      issuer: null,
      created_at: now,
    },
  ],
  installed_equipment_work_links: [
    {
      id: '6c000000-0000-4000-8000-000000000031',
      organization_id: ORGANIZATION_A,
      equipment_id: equipmentId,
      job_id: jobId,
    },
  ],
  maintenance_coverages: [
    {
      id: coverageId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      site_id: siteId,
      coverage_number: 'WA-0120',
      reference: officeOnly.coverageReference,
      operational_note: officeOnly.coverageNote,
      status: 'active',
    },
  ],
  maintenance_plans: [
    {
      id: planId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      site_id: siteId,
      plan_number: fieldFacts.plan,
      maintenance_coverage_id: coverageId,
      current_revision_id: revisionId,
      status: 'active',
    },
  ],
  maintenance_plan_revisions: [
    {
      id: revisionId,
      organization_id: ORGANIZATION_A,
      maintenance_plan_id: planId,
      template_version_id: templateVersionId,
      operational_instructions: fieldFacts.instructions,
    },
  ],
  maintenance_plan_revision_equipment: [
    { organization_id: ORGANIZATION_A, maintenance_plan_revision_id: revisionId, equipment_id: equipmentId },
  ],
  maintenance_due_work: [
    {
      id: '6c000000-0000-4000-8000-000000000041',
      organization_id: ORGANIZATION_A,
      maintenance_plan_id: planId,
      maintenance_plan_revision_id: revisionId,
      job_id: jobId,
      status: 'visit_created',
      due_date: '2026-10-02',
      original_due_date: '2026-10-02',
      window_start_date: '2026-09-25',
      window_end_date: '2026-10-09',
    },
  ],
  work_template_versions: [
    {
      id: templateVersionId,
      organization_id: ORGANIZATION_A,
      template_id: '6c000000-0000-4000-8000-000000000042',
      version_number: 1,
      status: 'published',
      name: 'Wartung Wärmepumpe',
      description: null,
    },
  ],
  inventory_items: [
    {
      id: itemId,
      organization_id: ORGANIZATION_A,
      name: 'Filtereinsatz',
      unit: 'Stk',
      item_type: 'material',
      is_active: true,
      is_billable: true,
      track_quantity: true,
      track_individual_assets: false,
      purchase_price_cents: officeOnly.purchasePriceCents,
      sale_price_cents: officeOnly.salePriceCents,
      currency_code: 'EUR',
      tax_rate_basis_points: 1900,
    },
  ],
  job_material_lines: [
    materialLine('6c000000-0000-4000-8000-000000000051', jobId),
    materialLine('6c000000-0000-4000-8000-000000000052', childJobId),
  ],
  work_artifacts: [
    {
      id: draftId,
      organization_id: ORGANIZATION_A,
      job_id: childJobId,
      project_id: null,
      kind: 'work_report',
      status: 'draft',
      current_revision_id: draftRevisionId,
      created_by: colleagueId,
      created_at: now,
      updated_at: now,
      version: 1,
    },
  ],
  work_artifact_revisions: [
    {
      id: draftRevisionId,
      organization_id: ORGANIZATION_A,
      artifact_id: draftId,
      kind: 'work_report',
      revision_number: 1,
      title: officeOnly.draftTitle,
      visibility: 'internal_only',
      created_by: colleagueId,
      created_at: now,
      captured_at: now,
    },
  ],
  // The responsibility resolution reads the caller's role from these rows; `signInAsMember` sets them.
  organization_members: [],
  employee_records: [],
});

const { default: JobDetailPage } = await import('@/app/(app)/auftraege/[jobNumber]/page');
const { default: ProjectJobPage } = await import(
  '@/app/(app)/auftraege/projekt/[projectNumber]/[jobNumber]/page'
);
const { JobDetailContent } = await import('@/components/auftraege/job-detail/job-detail-content');
const { getAssignedEquipmentForJob, getInstalledEquipmentDetailByNumber } = await import(
  '@/lib/installed-equipment/actions'
);
const { getAssignedMaintenanceContextForJob } = await import('@/lib/maintenance/actions');
const { getAssignedServiceContextForJob } = await import('@/lib/service-cases/actions');
const { getJobMaterialLines } = await import('@/lib/inventory/actions');
const { getWorkArtifacts } = await import('@/lib/work-artifacts/actions');

const params = <T>(value: T) => ({ params: Promise.resolve(value) });
const pages = {
  standalone: () => JobDetailPage(params({ jobNumber })),
  projectJob: () => ProjectJobPage(params({ projectNumber, jobNumber: childJobNumber })),
} satisfies Record<string, Render>;
const notAuthorized = { success: false, error: 'not_authorized' };

// The office view offers the organization's members for assignment.
world.rpc = ({ name }) =>
  name === 'get_org_members_for_user'
    ? {
        data: [{ user_id: colleagueId, first_name: 'Kora', last_name: 'Kollegin', role: 'employee' }],
        error: null,
      }
    : { data: null, error: null };

/** Signs in with the membership rows the responsibility resolution reads. */
function signInAsMember(role: 'admin' | 'buero' | 'employee', organizationId = ORGANIZATION_A): void {
  signInAs(world, role, organizationId);
  world.tables.organization_members = [{ organization_id: organizationId, user_id: CALLER_ID, role }];
  world.tables.employee_records = [
    {
      id: '6c000000-0000-4000-8000-0000000000e1',
      organization_id: organizationId,
      user_id: CALLER_ID,
      exit_date: null,
      personnel_access_lifecycles: [],
      personnel_onboarding_requirements: [],
    },
  ];
}

/** The field work pack's body, by the test id the browser specs scope it with. */
const isFieldWorkPack = (element: ReactElement) =>
  field(element, 'props', 'data-testid') === 'field-work-pack';

/** Every text and number below `value`, through nested objects, arrays and element props. */
function renderedValues(value: unknown, values: string[] = [], seen = new Set<object>()): string[] {
  if (typeof value === 'string') values.push(value);
  else if (typeof value === 'number') values.push(String(value));
  else if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);
    const children = isValidElement(value) ? [value.props] : Object.values(value);
    for (const child of children) renderedValues(child, values, seen);
  }
  return values;
}

/** The rendered elements of a page and every value their props carry. */
async function renderPage(page: Render) {
  const elements = await renderTree(page);
  return { elements, values: renderedValues(elements) };
}

function assertCarries(values: readonly string[], expected: string, label: string): void {
  assert.ok(
    values.some((value) => value.includes(expected)),
    `${label}: the page does not carry ${expected}`,
  );
}

function assertWithholds(values: readonly string[], label: string): void {
  for (const [name, secret] of Object.entries(officeOnly))
    assert.ok(
      !values.some((value) => value.includes(String(secret))),
      `${label}: the field worker receives ${name}`,
    );
}

// The assigned field worker gets the pack with its field facts and nothing office-only.
signInAsMember('employee');
for (const [label, page] of Object.entries(pages)) {
  const { elements, values } = await renderPage(page);
  assert.ok(elements.some(isFieldWorkPack), `${label}: the field worker gets no field work pack`);
  assert.ok(
    !elements.some((element) => element.type === JobDetailContent),
    `${label}: the field worker gets the office view with its assignment controls`,
  );
  for (const fact of [fieldFacts.customer, fieldFacts.site, fieldFacts.accessNotes, fieldFacts.contact])
    assertCarries(values, fact, label);
  assertWithholds(values, label);
}
const standalone = (await renderPage(pages.standalone)).values;
for (const fact of [fieldFacts.equipment, fieldFacts.plan, fieldFacts.instructions, fieldFacts.outcome])
  assertCarries(standalone, fact, 'standalone');
// The readers behind the pack withhold the same values themselves.
const lines = await getJobMaterialLines(jobId);
assert.equal(field(lines, 'success'), true, 'the field worker reads no material line');
assert.deepEqual(
  field(lines, 'lines', '0', 'isBillable'),
  false,
  'the field worker reads the billable flag of a material line',
);
assert.equal(
  field(lines, 'lines', '0', 'billableQuantity'),
  0,
  'the field worker reads the billable quantity of a material line',
);
assert.deepEqual(
  await getWorkArtifacts({ targetType: 'job', targetId: childJobId }),
  { success: true, artifacts: [] },
  'the field worker reads a colleague’s internal draft',
);

// A field worker who is not assigned gets no pack, and the pack readers refuse them.
const unassigned = () => JobDetailPage(params({ jobNumber: unassignedJobNumber }));
assert.equal(await refusal(unassigned), 'redirect:/auftraege');
for (const reader of [
  getAssignedEquipmentForJob,
  getAssignedMaintenanceContextForJob,
  getAssignedServiceContextForJob,
  getJobMaterialLines,
])
  assert.equal(
    field(await reader(unassignedJobId), 'success'),
    false,
    `${reader.name} answers the unassigned field worker`,
  );

// A member of another organization gets no pack: the equipment reader refuses them, and the
// maintenance reader, scoped to their own organization, finds nothing of this one.
signInAsMember('admin', ORGANIZATION_B);
assert.equal(await refusal(pages.projectJob), 'route-redirect:/auftraege');
assert.deepEqual(await getAssignedEquipmentForJob(jobId), notAuthorized);
assert.deepEqual(
  await getAssignedMaintenanceContextForJob(jobId),
  { success: true, contexts: [] },
  'the maintenance read of another organization finds a context of this one',
);

// The owning organization's office opens the same jobs in the office view with the office-only values.
for (const role of ['buero', 'admin'] as const) {
  signInAsMember(role);
  for (const [label, page] of Object.entries(pages)) {
    const { elements, values } = await renderPage(page);
    assert.ok(
      elements.some((element) => element.type === JobDetailContent),
      `${role} on ${label}: no office view`,
    );
    assert.ok(!elements.some(isFieldWorkPack), `${role} on ${label}: the office gets the field work pack`);
    assert.equal(
      field(
        elements.find((element) => element.type === JobDetailContent),
        'props',
        'members',
        'length',
      ),
      1,
      `${role} on ${label}: the office view offers no member to assign`,
    );
    for (const secret of [officeOnly.siteNotes, officeOnly.contactEmail, officeOnly.contactNotes])
      assertCarries(values, secret, `${role} on ${label}`);
  }
}
signInAsMember('buero');
const officeEquipment = renderedValues(await getInstalledEquipmentDetailByNumber('ANL-0118'));
for (const secret of [officeOnly.serialNumber, officeOnly.warrantyProvider])
  assertCarries(officeEquipment, secret, 'buero on the equipment');
const officeLines = await getJobMaterialLines(jobId);
assert.equal(field(officeLines, 'lines', '0', 'isBillable'), true);
assert.equal(
  field(officeLines, 'lines', '0', 'billableQuantity'),
  officeOnly.billableQuantity,
  'the office reads no billable quantity',
);
assert.equal(
  field(await getWorkArtifacts({ targetType: 'job', targetId: childJobId }), 'artifacts', 'length'),
  1,
  'the office reads no internal draft',
);
