// The real work and service pages over the in-memory database: a field worker
// who opens the Arbeitsvorlagen, the equipment register, the service cases,
// the maintenance workspace, or a project job or its handover that is not
// assigned to them is sent away, and a member of another organization who
// opens a job, a project, its handover, an equipment or a service case by its
// number sees none of it. Each page's own reader refuses the same caller. A
// Büro member of the owning organization opens the same numbers, so each
// refusal answers the role or the organization, not a missing row.
import assert from 'node:assert/strict';
import { CALLER_ID, ORGANIZATION_A, ORGANIZATION_B, signInAs } from './action-boundary-world';
import { field, installPageWorld, refusal, renderTree, type Render } from './page-render';

const projectId = '6b000000-0000-4000-8000-000000000001';
const jobId = '6b000000-0000-4000-8000-000000000002';
const childJobId = '6b000000-0000-4000-8000-000000000003';
const colleagueId = '6b000000-0000-4000-8000-000000000004';
const templateId = '6b000000-0000-4000-8000-000000000005';
const templateVersionId = '6b000000-0000-4000-8000-000000000009';
const equipmentId = '6b000000-0000-4000-8000-000000000006';
const caseId = '6b000000-0000-4000-8000-000000000007';
const coverageId = '6b000000-0000-4000-8000-000000000008';
const clientId = '6b000000-0000-4000-8000-00000000000a';
const siteId = '6b000000-0000-4000-8000-00000000000b';
const ownChildJobId = '6b000000-0000-4000-8000-00000000000c';
const projectNumber = 'P-2026-016';
const jobNumber = 'A-2026-014';
const childJobNumber = 'P-2026-016-1';
const ownChildJobNumber = 'P-2026-016-2';
const now = '2026-10-01T08:00:00.000Z';

const jobRow = (id: string, number: string, jobProjectId: string | null) => ({
  id,
  organization_id: ORGANIZATION_A,
  project_id: jobProjectId,
  client_id: null,
  site_id: null,
  contact_id: null,
  job_number: number,
  title: 'Heizung prüfen',
  description: null,
  status: 'nicht_bearbeitet',
  execution_state: null,
  execution_version: 0,
  priority: 'mittel',
  planned_date: null,
  location: null,
  created_by: CALLER_ID,
  created_at: now,
  updated_at: now,
});
const assignment = (id: string, assignedJobId: string, userId = colleagueId) => ({
  id,
  organization_id: ORGANIZATION_A,
  job_id: assignedJobId,
  user_id: userId,
  assigned_by: CALLER_ID,
  assigned_at: now,
});

const world = await installPageWorld({
  projects: [
    {
      id: projectId,
      organization_id: ORGANIZATION_A,
      project_number: projectNumber,
      name: 'Heizzentrale erneuern',
      description: null,
      client_id: null,
      site_id: null,
      contact_id: null,
      created_by: CALLER_ID,
      created_at: now,
      updated_at: now,
    },
  ],
  jobs: [
    jobRow(jobId, jobNumber, null),
    jobRow(childJobId, childJobNumber, projectId),
    jobRow(ownChildJobId, ownChildJobNumber, projectId),
  ],
  job_assignments: [
    assignment('6b000000-0000-4000-8000-000000000011', jobId),
    assignment('6b000000-0000-4000-8000-000000000012', childJobId),
    // The field worker's own job: the project job's refusal answers the assignment.
    assignment('6b000000-0000-4000-8000-000000000013', jobId, CALLER_ID),
    // The field worker's own project job: its handover still needs the handover review.
    assignment('6b000000-0000-4000-8000-000000000014', ownChildJobId, CALLER_ID),
  ],
  work_templates: [
    {
      id: templateId,
      organization_id: ORGANIZATION_A,
      target_type: 'job',
      name: 'Geschützte Vorlage',
      description: null,
      archived_at: null,
      draft_version_id: null,
      current_published_version_id: templateVersionId,
      updated_at: now,
    },
  ],
  work_template_versions: [
    {
      id: templateVersionId,
      organization_id: ORGANIZATION_A,
      template_id: templateId,
      version_number: 1,
      status: 'published',
      name: 'Geschützte Vorlage',
      description: null,
      updated_at: now,
    },
  ],
  clients: [
    { id: clientId, organization_id: ORGANIZATION_A, name: 'Geschützter Kunde', client_type: 'privat' },
  ],
  client_sites: [
    { id: siteId, organization_id: ORGANIZATION_A, client_id: clientId, name: 'Heizzentrale', address: null },
  ],
  installed_equipment: [
    {
      id: equipmentId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      site_id: siteId,
      equipment_number: 'ANL-0001',
    },
  ],
  service_cases: [
    {
      id: caseId,
      organization_id: ORGANIZATION_A,
      client_id: clientId,
      site_id: siteId,
      case_number: 'SF-0001',
      summary: 'Geschützter Fall',
    },
  ],
  // The responsibility resolution reads the caller's role from these rows; `signInAsMember` sets them.
  organization_members: [],
  employee_records: [],
  maintenance_coverages: [{ id: coverageId, organization_id: ORGANIZATION_A }],
});

const { default: WorkTemplatesPage } = await import('@/app/(app)/arbeitsvorlagen/page');
const { default: JobDetailPage } = await import('@/app/(app)/auftraege/[jobNumber]/page');
const { default: ProjectDetailPage } = await import('@/app/(app)/auftraege/projekt/[projectNumber]/page');
const { default: ProjectJobPage } = await import(
  '@/app/(app)/auftraege/projekt/[projectNumber]/[jobNumber]/page'
);
const { default: ProjectHandoverPage } = await import(
  '@/app/(app)/auftraege/projekt/[projectNumber]/uebergabe/page'
);
const { default: ProjectJobHandoverPage } = await import(
  '@/app/(app)/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe/page'
);
const { default: EquipmentDetailPage } = await import('@/app/(app)/service/anlagen/[equipmentNumber]/page');
const { default: ServiceCasesPage } = await import('@/app/(app)/service/faelle/page');
const { default: ServiceCaseDetailPage } = await import('@/app/(app)/service/faelle/[caseNumber]/page');
const { default: MaintenancePage } = await import('@/app/(app)/service/wartung/page');
const { WorkHandoverPage } = await import('@/components/auftraege/handover/work-handover-page');
const { getJobByNumber } = await import('@/lib/jobs/actions');
const { getProjectByNumber } = await import('@/lib/projects/actions');
const { getWorkHandoverWorkspaceByNumber } = await import('@/lib/work-handover/actions');
const { getWorkArtifacts } = await import('@/lib/work-artifacts/actions');
const { getWorkTemplates, getPublishedWorkTemplates } = await import('@/lib/work-templates/actions');
const { getInstalledEquipmentDetailByNumber } = await import('@/lib/installed-equipment/actions');
const { getServiceCaseDetailByNumber } = await import('@/lib/service-cases/actions');
const { getServiceCasePage } = await import('@/lib/service-cases/list-page-server');
const { getMaintenanceWorkspace } = await import('@/lib/maintenance/actions');

const searchParams = Promise.resolve({});
const params = <T>(value: T) => ({ params: Promise.resolve(value) });
const pages = {
  '/arbeitsvorlagen': () => WorkTemplatesPage(),
  '/auftraege/[jobNumber]': () => JobDetailPage(params({ jobNumber })),
  '/auftraege/projekt/[projectNumber]': () => ProjectDetailPage(params({ projectNumber })),
  '/auftraege/projekt/[projectNumber]/[jobNumber]': () =>
    ProjectJobPage(params({ projectNumber, jobNumber: childJobNumber })),
  '/auftraege/projekt/[projectNumber]/uebergabe': () => ProjectHandoverPage(params({ projectNumber })),
  '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe': () =>
    ProjectJobHandoverPage(params({ projectNumber, jobNumber: childJobNumber })),
  '/service/anlagen/[equipmentNumber]': () => EquipmentDetailPage(params({ equipmentNumber: 'ANL-0001' })),
  '/service/faelle': () => ServiceCasesPage({ searchParams }),
  '/service/faelle/[caseNumber]': () => ServiceCaseDetailPage(params({ caseNumber: 'SF-0001' })),
  '/service/wartung': () => MaintenancePage({ searchParams }),
} satisfies Record<string, Render>;
// The handover routes render this server component, which redirects itself.
const syncServerComponents = new Set([WorkHandoverPage]);
const refused = (page: Render) => refusal(page, syncServerComponents);
const workspaceQuery = { search: '', duePage: 1, planPage: 1, coveragePage: 1 };
const notAuthorized = { success: false, error: 'not_authorized' };

/** Signs in with the membership rows the handover-review responsibility resolves from. */
function signInAsMember(role: 'admin' | 'buero' | 'employee', organizationId = ORGANIZATION_A): void {
  signInAs(world, role, organizationId);
  world.tables.organization_members = [{ organization_id: organizationId, user_id: CALLER_ID, role }];
  world.tables.employee_records = [
    {
      id: '6b000000-0000-4000-8000-0000000000e1',
      organization_id: organizationId,
      user_id: CALLER_ID,
      exit_date: null,
      personnel_access_lifecycles: [],
      personnel_onboarding_requirements: [],
    },
  ];
}

// The page selections return the organization's rows as if they ignored the
// organization; the row reads still name the caller's (supabase/tests/*_list_pages.sql).
const selection = (ids: string[]) => ({ total: ids.length, hasAny: ids.length > 0, ids });
world.rpc = ({ name }) => {
  if (name === 'list_service_case_page') return { data: selection([caseId]), error: null };
  if (name === 'list_maintenance_workspace_page')
    return {
      data: { due: selection([]), plans: selection([]), coverages: selection([coverageId]) },
      error: null,
    };
  return { data: null, error: null };
};

/** The props of the first rendered element that carries `prop`. */
async function renderedProp(page: Render, prop: string): Promise<unknown> {
  const element = (await renderTree(page)).find((candidate) => field(candidate, 'props', prop) !== undefined);
  assert.ok(element, `nothing rendered ${prop}`);
  return field(element, 'props', prop);
}

// A field worker of the organization reaches no office page of work or service,
// and no project job or handover that is not assigned to them.
signInAsMember('employee');
const employeeRefusals: ReadonlyArray<readonly [keyof typeof pages, string]> = [
  ['/arbeitsvorlagen', 'redirect:/dashboard'],
  ['/auftraege/projekt/[projectNumber]/[jobNumber]', 'redirect:/auftraege'],
  ['/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe', 'redirect:/auftraege'],
  ['/auftraege/projekt/[projectNumber]/uebergabe', 'redirect:/auftraege'],
  ['/service/anlagen/[equipmentNumber]', 'redirect:/auftraege'],
  ['/service/faelle', 'redirect:/auftraege'],
  ['/service/faelle/[caseNumber]', 'redirect:/auftraege'],
  ['/service/wartung', 'redirect:/auftraege'],
];
for (const [route, expected] of employeeRefusals)
  assert.equal(await refused(pages[route]), expected, `employee on ${route}`);
// The readers refuse the field worker themselves, not only the pages.
assert.deepEqual(await getWorkTemplates(), notAuthorized);
assert.deepEqual(await getJobByNumber(childJobNumber), notAuthorized);
assert.equal((await getJobByNumber(jobNumber)).success, true, 'the field worker opens no own job');
assert.deepEqual(await getInstalledEquipmentDetailByNumber('ANL-0001'), notAuthorized);
assert.deepEqual(await getServiceCasePage({ status: 'all', search: '', page: 1 }), notAuthorized);
assert.deepEqual(await getServiceCaseDetailByNumber('SF-0001'), notAuthorized);
assert.deepEqual(await getMaintenanceWorkspace(workspaceQuery), notAuthorized);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'job', targetNumber: childJobNumber, projectNumber }),
  { success: false, error: 'work_handover_not_authorized' },
);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'project', targetNumber: projectNumber }),
  { success: false, error: 'work_handover_not_authorized' },
);
// The assignment opens the project job, never its handover.
assert.equal(
  (await getJobByNumber(ownChildJobNumber)).success,
  true,
  'the field worker opens no own project job',
);
assert.equal(
  await refused(() => ProjectJobHandoverPage(params({ projectNumber, jobNumber: ownChildJobNumber }))),
  'redirect:/auftraege',
  'employee on the handover of their own project job',
);
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({
    targetType: 'job',
    targetNumber: ownChildJobNumber,
    projectNumber,
  }),
  { success: false, error: 'work_handover_not_authorized' },
);

// A member of another organization finds no job, project, handover, equipment
// or case of the organization by its number, and none of its templates.
signInAsMember('admin', ORGANIZATION_B);
const outsiderRefusals: ReadonlyArray<readonly [keyof typeof pages, string]> = [
  ['/auftraege/[jobNumber]', 'route-redirect:/auftraege'],
  ['/auftraege/projekt/[projectNumber]', 'route-redirect:/auftraege'],
  ['/auftraege/projekt/[projectNumber]/[jobNumber]', 'route-redirect:/auftraege'],
  ['/auftraege/projekt/[projectNumber]/uebergabe', 'redirect:/auftraege'],
  ['/service/anlagen/[equipmentNumber]', 'notFound'],
  ['/service/faelle/[caseNumber]', 'notFound'],
];
for (const [route, expected] of outsiderRefusals)
  assert.equal(await refused(pages[route]), expected, `outsider on ${route}`);
assert.deepEqual(await getJobByNumber(jobNumber), { success: false, error: 'job_not_found' });
assert.deepEqual(await getProjectByNumber(projectNumber), { success: false, error: 'project_not_found' });
assert.deepEqual(await getWorkArtifacts({ targetType: 'job', targetId: jobId }), notAuthorized);
// A handover-review holder of the other organization, so the refusal answers the organization.
assert.deepEqual(
  await getWorkHandoverWorkspaceByNumber({ targetType: 'project', targetNumber: projectNumber }),
  { success: false, error: 'work_handover_target_not_found' },
);
assert.deepEqual(await renderedProp(pages['/arbeitsvorlagen'], 'initialTemplates'), []);
assert.deepEqual(await getPublishedWorkTemplates('job'), { success: true, data: [] });
assert.deepEqual(field(await renderedProp(pages['/service/wartung'], 'initial'), 'coverages'), []);

// Büro of the owning organization opens the same numbers and sees the same records.
signInAsMember('buero');
for (const number of [jobNumber, childJobNumber])
  assert.equal((await getJobByNumber(number)).success, true, `buero opens ${number}`);
assert.equal((await getProjectByNumber(projectNumber)).success, true, 'buero opens the project');
// Büro holds the handover review and reaches the project's workspace read.
world.rpcCalls.length = 0;
await getWorkHandoverWorkspaceByNumber({ targetType: 'project', targetNumber: projectNumber });
assert.ok(
  world.rpcCalls.some(
    ({ name, args }) => name === 'get_work_handover_gate_snapshot' && args.p_target_id === projectId,
  ),
  'buero does not reach the project handover',
);
assert.equal(
  field(await renderedProp(pages['/arbeitsvorlagen'], 'initialTemplates'), '0', 'name'),
  'Geschützte Vorlage',
);
const published = await getPublishedWorkTemplates('job');
assert.equal(field(published, 'data', 'length'), 1, 'buero is offered no published template');
assert.equal(
  field(await renderedProp(pages['/service/anlagen/[equipmentNumber]'], 'initial'), 'id'),
  equipmentId,
);
assert.equal(field(await renderedProp(pages['/service/faelle'], 'initialPage'), 'cases', '0', 'id'), caseId);
assert.equal(
  field(await renderedProp(pages['/service/faelle/[caseNumber]'], 'initial'), 'serviceCase', 'id'),
  caseId,
);
assert.equal(
  field(await renderedProp(pages['/service/wartung'], 'initial'), 'coverages', '0', 'id'),
  coverageId,
);
